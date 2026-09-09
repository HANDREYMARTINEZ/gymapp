-- Los planes que se quedaron con el azul rey, al amarillo de la marca.
--
-- El color de un plan es la rayita de la izquierda en la lista de Planes. Los
-- que se crearon antes del cambio de paleta llevan el azul que ponia el
-- formulario por defecto, y sobre el negro y amarillo de ahora se ven como una
-- pieza de otra app.
--
-- Igual que con el color de los correos: solo se toca el azul exacto que ponia
-- el programa. Un color elegido a mano se respeta, y los planes sin color se
-- quedan sin color -- que es lo que hace la lista pintar su raya gris por
-- defecto, no un fallo.
UPDATE planes
   SET color = '#ffe500'
 WHERE lower(color) = '#3b5bdb';
