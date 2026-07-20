import type { PlopTypes } from "@turbo/gen";

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setGenerator("feature", {
    description: "Scaffold a new feature slice in packages/client/src/features",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Feature name (kebab-case, e.g. user-profile):",
        validate: (input: string) =>
          /^[a-z][a-z0-9-]*$/.test(input) || "Use kebab-case: lowercase, digits, hyphens.",
      },
    ],
    actions: [
      {
        type: "add",
        path: "packages/client/src/features/{{kebabCase name}}/index.ts",
        templateFile: "templates/feature/index.ts.hbs",
      },
      {
        type: "add",
        path: "packages/client/src/features/{{kebabCase name}}/model.ts",
        templateFile: "templates/feature/model.ts.hbs",
      },
      {
        type: "add",
        path: "packages/client/src/features/{{kebabCase name}}/ui.tsx",
        templateFile: "templates/feature/ui.tsx.hbs",
      },
    ],
  });
}
