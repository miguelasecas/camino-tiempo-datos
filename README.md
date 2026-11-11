# camino-tiempo-datos

Previsión del tiempo para la app del Camino de Santiago, actualizada cada hora.

- Un programa (`actualizar.js`) descarga de AEMET OpenData la previsión horaria de los municipios del Camino (`municipios.json`) y la publica en `previsiones.json`.
- Lo ejecuta GitHub Actions cada hora (`.github/workflows/actualizar.yml`).
- La clave de AEMET se guarda como secreto del repositorio (`AEMET_API_KEY`) y no aparece en ningún archivo.
- No contiene datos personales de nadie: solo la previsión pública del tiempo.

**Fuente: AEMET (Agencia Estatal de Meteorología).** Información elaborada utilizando, entre otras, la obtenida de la Agencia Estatal de Meteorología. AEMET no participa, patrocina ni apoya esta app.
