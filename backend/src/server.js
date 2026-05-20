const express = require("express");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  return "Running";
});

app.listen(5000, () => {
  console.log("app running");
});
