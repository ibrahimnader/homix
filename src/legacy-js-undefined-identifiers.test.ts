import path from "path";
import ts from "typescript";

/**
 * The legacy backend (app/**, config/**) is plain JavaScript that `tsc` does not check. A missing `require` there only fails
 * at runtime — e.g. an undefined `SHIPMENTS_STATUS` inside order creation silently stopped every Shopify import, webhook and
 * manual order while all unit tests (which mock that path) stayed green. This test fails on any undefined identifier
 * (TS2304 and TS2552 «Cannot find name») in those files.
 */
describe("legacy JS files", () => {
  it("reference no undefined identifiers", () => {
    const root = path.resolve(__dirname, "..");
    const files = ts.sys
      .readDirectory(root, [".js"], ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/src/**", "**/migrations/**", "**/uploads/**"], ["app/**/*.js", "config/**/*.js"])
      .filter((file) => /[\\/](app|config)[\\/]/.test(file));
    expect(files.length).toBeGreaterThan(20);

    const program = ts.createProgram(files, {
      allowJs: true,
      checkJs: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      types: ["node"],
      typeRoots: [path.join(root, "node_modules", "@types")],
      noResolve: false,
      maxNodeModuleJsDepth: 0,
    });

    const problems: string[] = [];
    for (const sourceFile of program.getSourceFiles()) {
      if (!files.includes(path.resolve(sourceFile.fileName))) continue;
      for (const diagnostic of program.getSemanticDiagnostics(sourceFile)) {
        if (diagnostic.code !== 2304 && diagnostic.code !== 2552) continue; // 2552 = «Cannot find name … Did you mean …?»
        const { line } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        problems.push(`${path.relative(root, sourceFile.fileName)}:${line + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
      }
    }
    expect(problems).toEqual([]);
  }, 120000);
});
