import { useState } from "react";
import axios from "axios";
import DesignTest from "./DesignTest";

const API_URL = import.meta.env.VITE_API_URL;

function App() {
  const [backendStatus, setBackendStatus] = useState("Not checked yet");
  const [dbStatus, setDbStatus] = useState("Not checked yet");

  const checkBackend = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/health`);
      setBackendStatus(`✅ ${res.data.message}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setBackendStatus(`❌ ${message}`);
    }
  };

  const checkDatabase = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/db-test`);
      const row = res.data.data[0];
      setDbStatus(`✅ ${row ? row.message : "Connected, but table is empty"}`);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setDbStatus(`❌ ${err.response?.data?.message || err.message}`);
      } else {
        setDbStatus("❌ Unknown error");
      }
    }
  };

  return (
    <div style={{ padding: 32 }}>
      <h1>PandiWasto</h1>

      <button onClick={checkBackend}>Check Backend</button>
      <p>{backendStatus}</p>

      <button onClick={checkDatabase}>Check Database</button>
      <p>{dbStatus}</p>

      <DesignTest />
    </div>
  );
}

export default App;