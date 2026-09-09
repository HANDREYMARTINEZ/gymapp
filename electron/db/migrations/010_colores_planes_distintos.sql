-- Un tono distinto para cada plan que venia del azul viejo.
--
-- La 009 los dejo a todos del mismo amarillo, que es exactamente el problema que
-- ya tenian con el azul: la rayita de color de la lista de Planes no sirve para
-- distinguir nada si todos la llevan igual. Aqui se reparten.
--
-- El reparto: la mensualidad se queda con el amarillo de la marca por ser el
-- plan principal, el de dia va en naranja, y las dos tiqueteras en verde y lila
-- para que no se confundan entre si.
--
-- Cada UPDATE exige que el color siga siendo el amarillo que puso la 009: si
-- para cuando esto corra alguien ya le eligio otro a mano, se respeta. Y se
-- filtra por nombre, asi que en una instalacion que no tenga estos planes no
-- hace nada.
--
-- El nombre se compara con trim() y en minusculas porque los planes salieron de
-- una hoja de calculo: el plan de dia se llama "Dia " con un espacio detras, y
-- comparandolo tal cual se quedaba fuera del reparto sin que nada lo avisara.
UPDATE planes SET color = '#ffa94d' WHERE lower(trim(nombre)) = 'dia'               AND lower(color) = '#ffe500';
UPDATE planes SET color = '#51cf66' WHERE lower(trim(nombre)) = 'paquete 10 clases' AND lower(color) = '#ffe500';
UPDATE planes SET color = '#b197fc' WHERE lower(trim(nombre)) = '20 dias tickets'   AND lower(color) = '#ffe500';
