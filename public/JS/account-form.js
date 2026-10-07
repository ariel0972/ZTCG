import { api, rememberSession, navbar, message } from "./auth.js";
void navbar();
const form = document.getElementById("auth-form");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    delete data.lembrar;
    const result = await api(
      form.dataset.mode === "login" ? "/auth/logar" : "/auth/registrar",
      { method: "POST", body: JSON.stringify(data) },
    );
    if (form.dataset.mode === "login") {
      rememberSession(result, form.elements.lembrar.checked);
      location.href = "/";
    } else {
      message(result.content);
      form.reset();
      setTimeout(() => {
        location.href = "/HTML/login.html";
      }, 1200);
    }
  } catch (error) {
    message(error.message, true);
  } finally {
    button.disabled = false;
  }
});
