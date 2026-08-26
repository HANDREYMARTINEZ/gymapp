import { useState } from 'react';

export default function App() {
  const [resultado, setResultado] = useState('(sin probar)');

  async function probar() {
    await window.api.config.set('prueba', 'hola desde React');
    const valor = await window.api.config.get('prueba');
    setResultado(valor);
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>GymApp — esqueleto vivo</h1>
      <button onClick={probar}>Probar IPC</button>
      <p>Resultado: {resultado}</p>
    </div>
  );
}