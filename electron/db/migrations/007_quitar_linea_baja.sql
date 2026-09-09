-- Fuera la coletilla de la baja.
--
-- Las plantillas por defecto acababan con una raya y la frase "si no quieres
-- recibir estos recordatorios, responde con la palabra BAJA". Andrey no la
-- quiere, y las plantillas que ya estan guardadas en su instalacion la llevan.
--
-- No se comparan las plantillas enteras contra el texto viejo: si alguien ya
-- habia cambiado una palabra del mensaje, esa comparacion fallaria y la coletilla
-- se quedaria puesta. Se corta desde la raya hacia abajo, y solo cuando debajo
-- esta esa frase, para no llevarse por delante una raya que alguien haya escrito
-- a proposito para otra cosa.
UPDATE config
   SET valor = rtrim(substr(valor, 1, instr(valor, char(10) || '---' || char(10)) - 1), char(10))
 WHERE clave IN ('recordatorios_cuerpo_vencida', 'recordatorios_cuerpo_por_vencer')
   AND instr(valor, char(10) || '---' || char(10)) > 0
   AND valor LIKE '%BAJA%';
