export default function BotonVolver({ onClick, texto = '← Volver' }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        color: 'var(--acento-claro)',
        cursor: 'pointer',
        fontSize: 14,
        padding: '4px 0',
        marginBottom: 12,
      }}
    >
      {texto}
    </button>
  );
}
