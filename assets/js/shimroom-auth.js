(function () {
  async function requestUser() {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    if (response.status === 401) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      return null;
    }
    if (!response.ok) return null;
    const payload = await response.json();
    return payload.user || null;
  }

  function createUserControl(user) {
    const topActions = document.querySelector(".top-actions");
    if (!topActions || !user) return;

    const wrap = document.createElement("span");
    wrap.className = "auth-user";

    const name = document.createElement("span");
    name.className = "auth-user-name";
    name.textContent = user.displayName || user.username;

    const role = document.createElement("span");
    role.className = "auth-user-role";
    role.textContent = user.role;

    const logout = document.createElement("button");
    logout.type = "button";
    logout.className = "auth-logout";
    logout.textContent = "로그아웃";
    logout.addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      location.href = "/login";
    });

    wrap.append(name, role, logout);
    topActions.prepend(wrap);
  }

  requestUser().then(user => {
    window.SHIMROOM_AUTH_USER = user;
    createUserControl(user);
  });
})();
