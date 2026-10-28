import { navbar, token, message } from "./auth.js";
import { createTutorialController } from "./tutorial-controller.js";
async function load() {
  if (!token()) {
    location.replace("/HTML/login.html");
    return;
  }
  const user = await navbar();
  if (!user) return;
  const controller = createTutorialController(document, user);
  try {
    await controller.load();
  } catch (e) {
    message(e.message, true);
  }
}
void load();
