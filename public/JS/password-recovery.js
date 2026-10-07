import { api, message } from "./auth.js";
const form = document.getElementById("password-form"),
  result = document.getElementById("recovery-result");
const token = new URLSearchParams(location.hash.slice(1)).get("token");
if (form.dataset.mode === "reset" && !/^[a-f\d]{64}$/.test(token || "")) {
  form.hidden = true;
  result.hidden = false;
  result.textContent = "Link inválido. Solicite outro link de recuperação.";
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const input = Object.fromEntries(new FormData(form));
    if (form.dataset.mode === "reset") input.token = token;
    const data = await api(
      `/auth/${form.dataset.mode === "reset" ? "reset-password" : "forgot-password"}`,
      { method: "POST", body: JSON.stringify(input) },
    );
    result.textContent = data.content;
    result.hidden = false;
    form.reset();
    if (form.dataset.mode === "reset") {
      form.hidden = true;
      history.replaceState(null, "", location.pathname);
      for (const storage of [localStorage, sessionStorage]) {
        storage.removeItem("token");
        storage.removeItem("playerProfile");
      }
    }
  } catch (error) {
    message(error.message, true);
  } finally {
    button.disabled = false;
  }
});
