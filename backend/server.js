import "dotenv/config";
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3001;

// CORS: tells the browser "requests from this address are allowed"
app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "PandiWasto backend is running" });
});

app.get("/api/db-test", async (req, res) => {
  const { data, error } = await supabase
    .from("connection_test")
    .select("*")
    .limit(1);

  if (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
  res.json({ status: "ok", data });
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});