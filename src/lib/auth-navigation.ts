type AuthNavigationRouter = {
  replace: (href: string) => void;
  refresh: () => void;
};

export function finishAuthentication(router: AuthNavigationRouter) {
  // Replace keeps the completed auth screen out of browser history. Refresh
  // then clears the client route cache so /home cannot reuse a signed-out tree.
  router.replace("/home");
  router.refresh();
}
