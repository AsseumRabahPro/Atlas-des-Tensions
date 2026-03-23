import { TensionMap } from "../components/TensionMap";

export default function HomePage() {
  return (
    <main className="page">
      <header className="hud">
        <h1>Global Tension Map</h1>
        <p>Real-time geopolitical pulse by country and geolocated events.</p>
      </header>
      <TensionMap />
    </main>
  );
}
