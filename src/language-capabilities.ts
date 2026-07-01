export type BlitzLanguageCapability = {
	extension: string;
	language: string;
	exactText: "supported";
	structuralAst: "supported" | "unsupported";
	setKey: "supported" | "unsupported";
	note: string;
};

export const blitzLanguageCapabilities = [
	{ extension: ".ts", language: "TypeScript", exactText: "supported", structuralAst: "supported", setKey: "supported", note: "Tree-sitter TypeScript grammar-backed structural edits." },
	{ extension: ".tsx", language: "TSX", exactText: "supported", structuralAst: "supported", setKey: "supported", note: "Tree-sitter TSX grammar-backed structural edits." },
	{ extension: ".js", language: "JavaScript", exactText: "supported", structuralAst: "supported", setKey: "unsupported", note: "Tree-sitter TypeScript grammar-backed structural edits for JS function declarations." },
	{ extension: ".jsx", language: "JSX", exactText: "supported", structuralAst: "unsupported", setKey: "unsupported", note: "JSX exact text works; JSX AST structural support is intentionally not exposed until grammar coverage is wired and tested." },
	{ extension: ".py", language: "Python", exactText: "supported", structuralAst: "supported", setKey: "unsupported", note: "Tree-sitter Python grammar-backed structural edits." },
	{ extension: ".go", language: "Go", exactText: "supported", structuralAst: "supported", setKey: "unsupported", note: "Tree-sitter Go grammar-backed structural edits." },
	{ extension: ".rs", language: "Rust", exactText: "supported", structuralAst: "supported", setKey: "unsupported", note: "Tree-sitter Rust grammar-backed structural edits." },
	{ extension: ".json", language: "JSON", exactText: "supported", structuralAst: "unsupported", setKey: "supported", note: "Config key edits supported through set_key, not AST body routes." },
	{ extension: ".jsonc", language: "JSONC", exactText: "supported", structuralAst: "unsupported", setKey: "unsupported", note: "Known gap: set_key does not support JSONC yet; use exact text or host merge." },
	{ extension: ".yaml", language: "YAML", exactText: "supported", structuralAst: "unsupported", setKey: "supported", note: "Config key edits supported through set_key, not AST body routes." },
	{ extension: ".toml", language: "TOML", exactText: "supported", structuralAst: "unsupported", setKey: "supported", note: "Config key edits supported through set_key, not AST body routes." },
	{ extension: ".md", language: "Markdown", exactText: "supported", structuralAst: "unsupported", setKey: "unsupported", note: "Plain/document text route only." },
	{ extension: ".html", language: "HTML", exactText: "supported", structuralAst: "unsupported", setKey: "unsupported", note: "Exact text route only." },
	{ extension: ".css", language: "CSS", exactText: "supported", structuralAst: "unsupported", setKey: "unsupported", note: "Exact text route only." },
] as const satisfies readonly BlitzLanguageCapability[];

export const minimalBlitzEditStructuralDeclineReason =
	"unsupported_structural_op_minimal" as const;

export const minimalBlitzEditDeclinedStructuralAliases = [
	"rr",
	"rb",
	"ib",
	"wb",
	"tc",
	"ru",
	"ia",
	"bt",
	"as",
	"ek",
	"dk",
	"sk",
	"replace",
	"exact_replace",
	"replace_exact",
	"repl",
	"insert_after",
	"insert_after_text",
] as const;

export const isMinimalBlitzEditStructuralAlias = (
	alias: string,
): alias is (typeof minimalBlitzEditDeclinedStructuralAliases)[number] =>
	(minimalBlitzEditDeclinedStructuralAliases as readonly string[]).includes(alias);
