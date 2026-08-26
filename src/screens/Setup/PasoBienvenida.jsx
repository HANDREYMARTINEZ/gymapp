export default function PasoBienvenida({ onSiguiente }) {
  return (
    <div>
      <h1>Bienvenido a GymApp</h1>
      <p>Vamos a configurar tu gimnasio en 4 pasos rápidos.</p>
      <button onClick={onSiguiente}>Comenzar</button>
    </div>
  );
}