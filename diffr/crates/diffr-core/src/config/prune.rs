//! Keep the config file sparse, so that later default changes reach it.
//! Remove each key whose removal leaves the resolved configuration unchanged.
use toml_edit::{DocumentMut, Item, TableLike};

/// Remove each value, then each table, whose removal leaves `resolve` of
/// the document unchanged: an object option is only valid whole. `version` stays, and so does
/// anything with a comment on it: a note marks intent.
pub(crate) fn prune(document: &mut DocumentMut, resolve: impl Fn(&str) -> Option<toml::Value>) {
    let Some(target) = resolve(&document.to_string()) else {
        return;
    };
    for tables in [false, true] {
        for path in removable(document.as_table(), tables) {
            if path == ["version"] {
                continue;
            }
            let path: Vec<&str> = path.iter().map(String::as_str).collect();
            let mut candidate = document.clone();
            remove(candidate.as_table_mut(), &path);
            if resolve(&candidate.to_string()).as_ref() == Some(&target) {
                *document = candidate;
            }
        }
    }
    hide_headers(document.as_table_mut());
}

/// Leave out the uncommented header of a table that only holds tables, such
/// as `[plugins.shape]` above `[plugins.shape.bundled.context]`.
fn hide_headers(table: &mut toml_edit::Table) {
    let only_tables = table.iter().all(|(_, item)| item.is_table());
    if only_tables && !table.is_empty() && !commented(table.decor()) {
        table.set_implicit(true);
    }
    for (_, item) in table.iter_mut() {
        if let Some(child) = item.as_table_mut() {
            hide_headers(child);
        }
    }
}

/// The dotted paths of the table's uncommented values or, with `tables`,
/// of its uncommented tables, deepest first. A table holding a comment at
/// any depth stays.
fn removable(table: &dyn TableLike, tables: bool) -> Vec<Vec<String>> {
    let mut paths = Vec::new();
    for (key, item) in table.iter() {
        if has_comment(table, key, item) {
            continue;
        }
        match item.as_table_like() {
            Some(child) => {
                for mut path in removable(child, tables) {
                    path.insert(0, key.to_owned());
                    paths.push(path);
                }
                if tables && !annotated(child) {
                    paths.push(vec![key.to_owned()]);
                }
            }
            None if !tables => paths.push(vec![key.to_owned()]),
            None => {}
        }
    }
    paths
}

/// Whether anything in the table, at any depth, has a comment.
fn annotated(table: &dyn TableLike) -> bool {
    table.iter().any(|(key, item)| {
        has_comment(table, key, item) || item.as_table_like().is_some_and(annotated)
    })
}

fn has_comment(table: &dyn TableLike, key: &str, item: &Item) -> bool {
    let key = table
        .key(key)
        .is_some_and(|key| commented(key.leaf_decor()));
    let item = match item {
        Item::Value(value) => value_has_comment(value),
        Item::Table(table) => commented(table.decor()),
        _ => false,
    };
    key || item
}

/// A comment on the value or anywhere inside it: between an array's
/// elements, after its last one, or on an inline table's entries.
fn value_has_comment(value: &toml_edit::Value) -> bool {
    let note = |raw: &toml_edit::RawString| raw.as_str().is_some_and(|text| text.contains('#'));
    commented(value.decor())
        || match value {
            toml_edit::Value::Array(array) => {
                note(array.trailing()) || array.iter().any(value_has_comment)
            }
            toml_edit::Value::InlineTable(table) => table.iter().any(|(key, value)| {
                table
                    .key(key)
                    .is_some_and(|key| commented(key.leaf_decor()))
                    || value_has_comment(value)
            }),
            _ => false,
        }
}

fn commented(decor: &toml_edit::Decor) -> bool {
    [decor.prefix(), decor.suffix()]
        .into_iter()
        .flatten()
        .any(|raw| raw.as_str().is_some_and(|text| text.contains('#')))
}

pub(crate) fn remove(table: &mut dyn TableLike, path: &[&str]) {
    match path {
        [key] => {
            table.remove(key);
        }
        [key, rest @ ..] => {
            if let Some(child) = table.get_mut(key).and_then(Item::as_table_like_mut) {
                remove(child, rest);
            }
        }
        [] => {}
    }
}

#[cfg(test)]
mod tests;
