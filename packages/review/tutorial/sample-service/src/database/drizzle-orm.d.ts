// The sample has no dependencies; this declares the slice of drizzle-orm it uses.
declare module "drizzle-orm/pg-core" {
  interface Column {
    primaryKey(): Column;
    notNull(): Column;
    defaultNow(): Column;
  }

  export function text(name: string): Column;
  export function integer(name: string): Column;
  export function timestamp(name: string): Column;
  export function pgTable(
    name: string,
    columns: Record<string, Column>,
  ): Record<string, Column>;
}
