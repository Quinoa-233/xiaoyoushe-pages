/**
 * 主站（xiaoyoushe.pages.dev）页面跳转到 GitHub Pages 镜像。
 *
 * 背景：pages.dev 在境内移动网络下经常握手很慢甚至打不开，而 GitHub Pages 那条线路
 * 实测更稳。这里只接管「页面导航」请求（/ 和 *.html），把访问者送到镜像站；
 * /api/* 与封面、海报等静态资源一律放行，镜像站的跨域回源（送花 / 时长 / 登录）才不会断。
 *
 * 用 302 而不是 301：301 会被浏览器长期缓存，万一以后换了正式域名或想让主站重新对外，
 * 用户浏览器还会一直往旧地址跳，收不回来。
 */
const PROD_HOST = 'xiaoyoushe.pages.dev';
const MIRROR = 'https://quinoa-233.github.io/xiaoyoushe-pages';

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // 预览部署（*.xiaoyoushe.pages.dev）保持原样，方便自己看新版本
  if (url.hostname !== PROD_HOST) return next();

  // 后端接口原样放行：镜像站的前端就是靠它取数据的
  if (url.pathname.startsWith('/api/')) return next();

  // 只跳文档请求，避免把 /covers/*.webp、/games/*/preview.mp4 也搬去镜像站
  const isDocument =
    (request.method === 'GET' || request.method === 'HEAD') &&
    (url.pathname === '/' || url.pathname.endsWith('.html'));

  if (!isDocument) return next();

  const target =
    url.pathname === '/'
      ? `${MIRROR}/`
      : `${MIRROR}${url.pathname}${url.search}`;

  return Response.redirect(target, 302);
}
