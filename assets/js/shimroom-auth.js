(function () {
  async function requestAuth() {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    if (!response.ok) return { user: null, canEdit: false };
    const payload = await response.json();
    return {
      user: payload.user || null,
      canEdit: Boolean(payload.canEdit)
    };
  }

  function loginUrl() {
    return `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }

  function createUserControl(user, canEdit) {
    const topActions = document.querySelector(".top-actions");
    if (!topActions) return;

    const wrap = document.createElement("span");
    wrap.className = "auth-user";

    if (!user) {
      const login = document.createElement("button");
      login.type = "button";
      login.className = "auth-login";
      login.textContent = "로그인";
      login.addEventListener("click", () => {
        location.href = loginUrl();
      });
      wrap.append(login);
      topActions.prepend(wrap);
      return;
    }

    const name = document.createElement("span");
    name.className = "auth-user-name";
    name.textContent = user.displayName || user.username;

    const role = document.createElement("span");
    role.className = "auth-user-role";
    role.textContent = canEdit ? user.role : `${user.role} · 보기`;

    const logout = document.createElement("button");
    logout.type = "button";
    logout.className = "auth-logout";
    logout.textContent = "로그아웃";
    logout.addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      location.href = location.pathname + location.search;
    });

    wrap.append(name, role, logout);
    topActions.prepend(wrap);
  }

  requestAuth().then(({ user, canEdit }) => {
    if (typeof setShimroomAuth === "function") setShimroomAuth(user, canEdit);
    else {
      window.SHIMROOM_AUTH_USER = user;
      window.SHIMROOM_AUTH_CAN_EDIT = canEdit;
    }
    createUserControl(user, canEdit);
  });
})();
