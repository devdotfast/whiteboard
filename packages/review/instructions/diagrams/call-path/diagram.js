const fn = (id, label, tag, code) =>
  wb.node({ id, kind: "component", label, tag, code, width: 210, height: 60 });

const click = wb.node({ id: "click", kind: "person", label: "Save clicked" });

const handler = fn("handler", "onSave", "Component · form.tsx", "on-save");

const validate = fn(
  "validate",
  "validateSettings",
  "Component · validate.ts",
  "validate",
);

const save = fn("save", "saveSettings", "Component · save.ts", "save");

const repository = fn(
  "repository",
  "SettingsRepository.put",
  "Component · repository.ts",
  "repository",
);

const db = wb.node({
  id: "db",
  kind: "database",
  label: "settings",
  tag: "Database · SQLite",
  code: "table",
});

wb.edge({ from: click, to: handler });

wb.edge({ from: handler, to: validate, code: "call-validate" });

wb.edge({ from: handler, to: save, code: "call-save" });

wb.edge({
  from: save,
  to: db,
  dashed: true,
  label: "removed",
  code: "old-write",
});

wb.edge({ from: save, to: repository, code: "call-repository" });

wb.edge({ from: repository, to: db, code: "write" });

await wb.layout({ direction: "down" });
