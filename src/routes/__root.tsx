import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MailRotor — Admin Console" },
      { name: "description", content: "Admin console for managing SMTP accounts, templates, and sequential email sending with rotation and pause/resume." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "MailRotor — Admin Console" },
      { property: "og:description", content: "Admin console for managing SMTP accounts, templates, and sequential email sending with rotation and pause/resume." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "MailRotor — Admin Console" },
      { name: "twitter:description", content: "Admin console for managing SMTP accounts, templates, and sequential email sending with rotation and pause/resume." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/eecf6852-6476-4154-865a-6e1d25118e3f/id-preview-19ffa0ae--8fb83ced-ace1-484a-a692-385b7b64d761.lovable.app-1779125966044.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/eecf6852-6476-4154-865a-6e1d25118e3f/id-preview-19ffa0ae--8fb83ced-ace1-484a-a692-385b7b64d761.lovable.app-1779125966044.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}
