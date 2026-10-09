export default {
  fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "diffsthatgetyoustiff.com") {
      url.hostname = "diffr.fast";
      url.protocol = "https:";

      return Response.redirect(url.href, 308);
    }

    return env.ASSETS.fetch(request);
  },
};
