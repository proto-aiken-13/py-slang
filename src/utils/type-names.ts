export function typeTranslator(type: string): string {
  switch (type) {
    case "bigint":
      return "int";
    case "number":
      return "float";
    case "boolean":
    case "bool":
      return "bool";
    case "string":
      return "str";
    case "complex":
      return "complex";
    case "undefined":
      return "NoneType";
    default:
      return "unknown";
  }
}
