// Robot de previsiones de la app del Camino.
// Lo ejecuta GitHub Actions cada hora (ver .github/workflows/actualizar.yml):
//  1) descarga de AEMET la previsión horaria de cada municipio de municipios.json;
//  2) se queda solo con lo que usa la app;
//  3) escribe publicar/previsiones.json, que GitHub publica en la web.
// La clave de AEMET la da GitHub como variable secreta AEMET_API_KEY: no está en este archivo
// y este programa nunca la escribe en pantalla ni en ningún archivo.
// Si un municipio falla, se reutiliza su previsión anterior (si tiene menos de 12 horas).

const fs = require('fs');
const path = require('path');

const BASE = 'https://opendata.aemet.es/opendata/api';
const CLAVE = process.env.AEMET_API_KEY;
const URL_ANTERIOR = process.env.URL_ANTERIOR; // dirección del archivo publicado la vez anterior
const PAUSA_MS = Number(process.env.PAUSA_MS || 4000);          // 4 s: AEMET permite unas 40 consultas por minuto y cada municipio son 2 (con 3 s pedía esperar a menudo)
const HORAS_MAX_ANTERIOR = 12;  // una previsión antigua solo se reutiliza si tiene menos de esto
const MAX_FALLOS = 20;          // si fallan más municipios, no se publica (queda el archivo anterior)

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Pide una URL y devuelve el texto. Los caracteres de control que a veces manda AEMET se cambian por espacios.
async function pedirTexto(url, opciones) {
  const r = await fetch(url, opciones);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const texto = new TextDecoder('utf-8').decode(bytes).replace(/[\u0000-\u001F]/g, ' ');
  return { estado: r.status, texto };
}

// Descarga la previsión horaria de un municipio (los dos pasos de AEMET), con reintentos si hay límite.
async function descargar(codigo) {
  const pausas = [10000, 30000, 60000];
  for (let intento = 0; ; intento++) {
    const r1 = await pedirTexto(`${BASE}/prediccion/especifica/municipio/horaria/${codigo}`, {
      headers: { api_key: CLAVE, Accept: 'application/json' },
    });
    let info = null;
    try { info = JSON.parse(r1.texto); } catch (e) {}
    const limite = r1.estado === 429 || info?.estado === 429;
    if (limite && intento < pausas.length) {
      console.log(`  ${codigo}: límite de AEMET, espero ${pausas[intento] / 1000} s`);
      await esperar(pausas[intento]);
      continue;
    }
    if (r1.estado === 401 || info?.estado === 401) throw new Error('AEMET no acepta la clave (¿caducada?)');
    if (!info?.datos) throw new Error(`sin enlace de datos (estado ${info?.estado ?? r1.estado})`);

    const r2 = await pedirTexto(info.datos);
    if (r2.estado === 429 && intento < pausas.length) {
      await esperar(pausas[intento]);
      continue;
    }
    return JSON.parse(r2.texto)[0];
  }
}

// Se queda solo con lo que usa la app, con la misma forma que manda AEMET
// (así el código de la app que lee la previsión casi no cambia).
function resumir(prev) {
  const lista = (l) => (l || []).map((x) => ({ periodo: x.periodo, value: x.value }));
  return {
    elaborado: prev.elaborado,
    prediccion: {
      dia: (prev.prediccion?.dia || []).map((d) => ({
        fecha: d.fecha,
        orto: d.orto,
        ocaso: d.ocaso,
        estadoCielo: lista(d.estadoCielo),
        temperatura: lista(d.temperatura),
        sensTermica: lista(d.sensTermica),
        precipitacion: lista(d.precipitacion),
        nieve: lista(d.nieve),
        probPrecipitacion: lista(d.probPrecipitacion),
        probNieve: lista(d.probNieve),
        probTormenta: lista(d.probTormenta),
      })),
    },
  };
}

async function leerAnterior() {
  if (!URL_ANTERIOR) return null;
  try {
    const r = await fetch(URL_ANTERIOR, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch (e) {
    return null;
  }
}

async function main() {
  if (!CLAVE) throw new Error('Falta el secreto AEMET_API_KEY en GitHub');
  const { municipios } = JSON.parse(fs.readFileSync(path.join(__dirname, 'municipios.json'), 'utf8'));
  const anterior = await leerAnterior();
  const ahora = Date.now();

  const resultado = {};
  const fallos = [];
  for (const [n, m] of municipios.entries()) {
    try {
      resultado[m.codigo] = { ...resumir(await descargar(m.codigo)), descargado: new Date().toISOString() };
    } catch (e) {
      const viejo = anterior?.municipios?.[m.codigo];
      const edadHoras = viejo ? (ahora - Date.parse(viejo.descargado)) / 3600000 : Infinity;
      if (edadHoras < HORAS_MAX_ANTERIOR) resultado[m.codigo] = viejo;
      fallos.push(`${m.codigo} ${m.municipio}: ${e.message}${edadHoras < HORAS_MAX_ANTERIOR ? ' (uso la anterior)' : ''}`);
      if (/clave/.test(e.message)) break; // con la clave mal no tiene sentido seguir
    }
    if ((n + 1) % 20 === 0) console.log(`${n + 1} de ${municipios.length} municipios`);
    await esperar(PAUSA_MS);
  }

  if (fallos.length > 0) console.log(`Fallos (${fallos.length}):\n  ` + fallos.join('\n  '));
  if (fallos.length > MAX_FALLOS || Object.keys(resultado).length === 0) {
    throw new Error(`Demasiados fallos (${fallos.length}): no publico nada y se queda el archivo anterior`);
  }

  const salida = {
    actualizado: new Date().toISOString(),
    fuente: 'AEMET (Agencia Estatal de Meteorología)',
    municipios: resultado,
  };
  const carpeta = path.join(__dirname, 'publicar');
  fs.mkdirSync(carpeta, { recursive: true });
  fs.writeFileSync(path.join(carpeta, 'previsiones.json'), JSON.stringify(salida));
  fs.writeFileSync(path.join(carpeta, 'index.html'),
    '<!doctype html><meta charset="utf-8"><title>Previsiones Camino</title>' +
    `<p>Previsión del tiempo para la app del Camino. Fuente: AEMET. Actualizado: ${salida.actualizado}</p>`);
  const kb = Math.round(fs.statSync(path.join(carpeta, 'previsiones.json')).size / 1024);
  console.log(`Listo: ${Object.keys(resultado).length} municipios, ${kb} KB.`);
}

main().catch((e) => {
  console.log('ERROR: ' + e.message);
  process.exit(1); // GitHub marca la ejecución como fallida y avisa por correo
});
