-- El azul rey de los correos, al amarillo de la marca.
--
-- La paleta de la app paso de azul a amarillo, y con ella el color por defecto
-- que trae el codigo. Pero el que de verdad manda en los correos es el que este
-- guardado en config, y en una instalacion que ya haya pasado alguna vez por
-- Configuracion sigue siendo el azul viejo: el gimnasio se veria amarillo en
-- pantalla y azul en el correo que le llega al cliente.
--
-- Solo se toca si sigue siendo exactamente el azul que ponia el programa. Un
-- color elegido a mano -- aunque sea otro azul -- es la decision de alguien y
-- no se pisa. Y se compara en minusculas porque el selector de color del
-- navegador devuelve el hex en minusculas, pero el que venia escrito en el
-- codigo pudo guardarse de cualquier forma.
UPDATE config
   SET valor = '#ffe500'
 WHERE clave = 'recordatorios_color'
   AND lower(valor) = '#3b5bdb';
