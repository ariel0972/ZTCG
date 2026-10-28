export const tutorialPath = "/tutorial";
export function landingPage(user) {
  return user?.tutorialRequired ? tutorialPath : "/";
}
export function needsTutorialRedirect(user, pathname) {
  return (
    !!user?.tutorialRequired &&
    ![tutorialPath, "/HTML/tutorial.html"].includes(pathname)
  );
}

export async function loginDestination(user, request) {
  if (user?.tutorialRequired) {
    try {
      if ((await request("/game/state")).match?.status === "ACTIVE")
        return "/HTML/index.html";
    } catch {}
  }
  return landingPage(user);
}
