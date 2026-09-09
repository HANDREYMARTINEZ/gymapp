// Dibuja la imagen de algo, o sus iniciales si no tiene. Lo segundo es lo
// normal: casi ningun producto va a llevar foto el primer dia, y una cuadricula
// llena de recuadros vacios se lee peor que una llena de iniciales.
export default function Miniatura({ url, nombre = '', lado = 40, radio = 'var(--radio)', fuente }) {
  const iniciales = (nombre || '')
    .trim().split(/\s+/).slice(0, 2)
    .map(p => p[0] || '')
    .join('')
    .toUpperCase() || '?';

  // Con un lado en pixeles sale un cuadrado fijo, para una fila de tabla. Con
  // "100%" se estira al ancho de su hueco y aspect-ratio lo mantiene cuadrado,
  // que es lo que necesita una cuadricula elastica.
  const elastico = typeof lado === 'string';

  return (
    <div style={{
      width: lado,
      height: elastico ? 'auto' : lado,
      aspectRatio: elastico ? '1' : undefined,
      flexShrink: 0,
      borderRadius: radio, overflow: 'hidden',
      background: 'var(--superficie-alta)', border: '1px solid var(--borde-suave)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: fuente || Math.round(lado / 2.6), fontWeight: 700, color: 'var(--texto-tenue)',
    }}>
      {url
        ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : iniciales}
    </div>
  );
}
