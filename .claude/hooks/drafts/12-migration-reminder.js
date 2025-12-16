#!/usr/bin/env node
/**
 * Migration Reminder
 *
 * TRIGGER: PostToolUse
 * MATCHER: Write|Edit|MultiEdit (on schema/model files)
 *
 * Reminds to create database migrations when schema or model files change.
 * Detects common ORM patterns (Prisma, TypeORM, Drizzle, etc.)
 *
 * EXIT CODES:
 *   0 - Always (non-blocking, reminder only)
 */

const fs = require("fs").promises;
const path = require("path");

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Patterns that indicate schema/model files
const SCHEMA_PATTERNS = [
	// Prisma
	/schema\.prisma$/,
	/prisma\/.*\.prisma$/,

	// TypeORM
	/entities?\/.*\.ts$/,
	/models?\/.*\.entity\.ts$/,

	// Drizzle
	/drizzle\/.*\.ts$/,
	/schema\.ts$/,

	// Sequelize
	/models?\/.*\.ts$/,

	// Generic database patterns
	/database\/.*schema.*\.ts$/,
	/db\/.*schema.*\.ts$/,
	/repositories?\/.*\.ts$/,

	// Migration files (to track existing migrations)
	/migrations?\/.*\.ts$/,
];

// Patterns in file content that indicate schema changes
const SCHEMA_CHANGE_PATTERNS = [
	// Adding/removing columns or fields
	/\@Column|@PrimaryColumn|@ManyToOne|@OneToMany|@ManyToMany/,
	/\.addColumn|\.dropColumn|\.renameColumn/,
	/\.create\s*Table|\.drop\s*Table|\.alter\s*Table/i,

	// Prisma schema changes
	/model\s+\w+\s*\{/,
	/@@map|@@id|@@unique|@@index/,

	// Drizzle schema
	/pgTable|mysqlTable|sqliteTable/,
	/serial|integer|varchar|text|boolean|timestamp/,

	// TypeORM decorators
	/@Entity|@Table|@Index/,

	// Generic SQL
	/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i,
	/ADD\s+COLUMN|DROP\s+COLUMN|MODIFY\s+COLUMN/i,
];

// ORM detection patterns
const ORM_PATTERNS = {
	prisma: {
		files: [/schema\.prisma$/, /prisma\//],
		command: "npx prisma migrate dev --name",
	},
	typeorm: {
		files: [/\.entity\.ts$/, /typeorm/],
		command: "npx typeorm migration:generate -n",
	},
	drizzle: {
		files: [/drizzle\//, /drizzle\.config/],
		command: "npx drizzle-kit generate:migration",
	},
	sequelize: {
		files: [/sequelize/, /\.sequelizerc/],
		command: "npx sequelize migration:generate --name",
	},
	knex: {
		files: [/knexfile/, /migrations\/.*\.js$/],
		command: "npx knex migrate:make",
	},
};

const colors = {
	blue: "\x1b[0;34m",
	green: "\x1b[0;32m",
	yellow: "\x1b[0;33m",
	cyan: "\x1b[0;36m",
	magenta: "\x1b[0;35m",
	reset: "\x1b[0m",
};

async function parseInput() {
	let data = "";
	for await (const chunk of process.stdin) {
		data += chunk;
	}
	return data.trim() ? JSON.parse(data) : null;
}

function isSchemaFile(filePath) {
	return SCHEMA_PATTERNS.some(pattern => pattern.test(filePath));
}

function hasSchemaChanges(content) {
	return SCHEMA_CHANGE_PATTERNS.some(pattern => pattern.test(content));
}

async function detectORM() {
	// Check for ORM configuration files
	const checks = [
		{ orm: "prisma", files: ["prisma/schema.prisma"] },
		{ orm: "typeorm", files: ["ormconfig.json", "ormconfig.js", "ormconfig.ts"] },
		{ orm: "drizzle", files: ["drizzle.config.ts", "drizzle.config.js"] },
		{ orm: "sequelize", files: [".sequelizerc", "sequelize.config.js"] },
		{ orm: "knex", files: ["knexfile.js", "knexfile.ts"] },
	];

	for (const { orm, files } of checks) {
		for (const file of files) {
			try {
				await fs.access(path.join(projectRoot, file));
				return orm;
			} catch {
				// File doesn't exist
			}
		}
	}

	// Check package.json dependencies
	try {
		const pkgPath = path.join(projectRoot, "package.json");
		const content = await fs.readFile(pkgPath, "utf8");
		const pkg = JSON.parse(content);
		const allDeps = {
			...pkg.dependencies,
			...pkg.devDependencies,
		};

		if (allDeps["@prisma/client"] || allDeps.prisma) return "prisma";
		if (allDeps.typeorm) return "typeorm";
		if (allDeps["drizzle-orm"]) return "drizzle";
		if (allDeps.sequelize) return "sequelize";
		if (allDeps.knex) return "knex";
	} catch (err) {
		// Can't read package.json
	}

	return null;
}

async function checkExistingMigrations() {
	const migrationDirs = [
		"migrations",
		"prisma/migrations",
		"src/migrations",
		"db/migrations",
		"database/migrations",
	];

	for (const dir of migrationDirs) {
		const fullPath = path.join(projectRoot, dir);
		try {
			const stat = await fs.stat(fullPath);
			if (stat.isDirectory()) {
				const files = await fs.readdir(fullPath);
				return {
					exists: true,
					path: dir,
					count: files.filter(f => /\.(ts|js|sql)$/.test(f)).length,
				};
			}
		} catch {
			// Directory doesn't exist
		}
	}

	return { exists: false };
}

function getContentFromInput(toolInput) {
	if (toolInput.content) return toolInput.content;
	if (toolInput.new_string) return toolInput.new_string;
	if (toolInput.edits) {
		return toolInput.edits.map(e => e.new_string || "").join("\n");
	}
	return "";
}

async function main() {
	const input = await parseInput();

	if (!input) {
		process.exit(0);
	}

	const { tool_input } = input;
	const filePath = tool_input?.file_path || tool_input?.path;
	const content = getContentFromInput(tool_input);

	if (!filePath) {
		process.exit(0);
	}

	// Check if this is a schema file
	if (!isSchemaFile(filePath)) {
		process.exit(0);
	}

	// Check if content has schema changes
	if (!hasSchemaChanges(content)) {
		process.exit(0);
	}

	const relativePath = path.relative(projectRoot, filePath);
	const orm = await detectORM();
	const migrations = await checkExistingMigrations();

	console.error("");
	console.error(`${colors.cyan}🗃️ Migration Reminder${colors.reset}`);
	console.error("────────────────────────────────────────────");
	console.error(`${colors.blue}[INFO]${colors.reset} Schema/model file modified: ${relativePath}`);
	console.error("");

	if (orm) {
		console.error(`${colors.magenta}Detected ORM:${colors.reset} ${orm}`);
	}

	if (migrations.exists) {
		console.error(`${colors.magenta}Existing migrations:${colors.reset} ${migrations.count} in ${migrations.path}/`);
	}

	console.error("");
	console.error(`${colors.yellow}📝 Migration Checklist:${colors.reset}`);
	console.error("");
	console.error("   [ ] Have you created a migration for these changes?");
	console.error("   [ ] Is the migration reversible (up/down)?");
	console.error("   [ ] Have you tested the migration locally?");
	console.error("   [ ] Will this migration work with existing data?");

	if (orm && ORM_PATTERNS[orm]) {
		console.error("");
		console.error(`${colors.cyan}Generate migration:${colors.reset}`);
		console.error(`   ${ORM_PATTERNS[orm].command} <migration_name>`);
	}

	console.error("");
	console.error(`${colors.cyan}Best practices:${colors.reset}`);
	console.error("   • Always backup database before migrations");
	console.error("   • Test migrations on staging first");
	console.error("   • Make migrations atomic (one change per migration)");
	console.error("   • Handle data transformation carefully");

	// Detect potential breaking changes
	const breakingPatterns = [
		{ pattern: /DROP|DELETE|REMOVE/i, warning: "Destructive change detected (DROP/DELETE)" },
		{ pattern: /NOT\s+NULL|required:\s*true/i, warning: "Adding NOT NULL constraint" },
		{ pattern: /UNIQUE|@unique|\.unique\(\)/i, warning: "Adding UNIQUE constraint" },
		{ pattern: /rename|@@map/i, warning: "Renaming detected - may need data migration" },
	];

	const warnings = breakingPatterns
		.filter(({ pattern }) => pattern.test(content))
		.map(({ warning }) => warning);

	if (warnings.length > 0) {
		console.error("");
		console.error(`${colors.yellow}⚠️ Potential breaking changes:${colors.reset}`);
		warnings.forEach(w => {
			console.error(`   ${colors.yellow}•${colors.reset} ${w}`);
		});
	}

	console.error("");
	console.error(`${colors.green}✅ Reminder logged (non-blocking)${colors.reset}`);
	process.exit(0);
}

main().catch(err => {
	console.error(`[ERROR] ${err.message}`);
	process.exit(0);
});
