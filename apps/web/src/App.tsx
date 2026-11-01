import { Stadium } from "./Stadium.js";

export function App() {
  return (
    <>
      <header className="wrap top">
        <span className="brand">NEAR POST</span>
        <nav className="nav" aria-label="Main">
          <a href="/" aria-current="page">
            Stadium
          </a>
        </nav>
      </header>
      <Stadium />
    </>
  );
}
