// Normalizar texto para buscar.
//
// En el mostrador nadie escribe las tildes, y el control del gimnasio trae los
// nombres en mayusculas. LIKE de SQLite solo ignora mayusculas en A-Z: buscar
// "saldano" o "saldano" con ene no encuentra a "ALEXANDRA SALDANO" escrito con
// ENE. Por eso el nombre se guarda ademas en una columna aparte, ya en
// minusculas y sin tildes, y es contra esa columna contra la que se busca.

function sinTildes(texto) {
  return String(texto == null ? '' : texto)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Lo que se guarda en clientes.nombre_busqueda y contra lo que se compara la
// caja de busqueda: sin tildes, en minusculas y con los espacios de sobra
// recogidos, para que "  ANA   MARIA " y "ana maria" sean la misma cosa.
function normalizarBusqueda(texto) {
  return sinTildes(texto).toLowerCase().trim().replace(/\s+/g, ' ');
}

module.exports = { sinTildes, normalizarBusqueda };
