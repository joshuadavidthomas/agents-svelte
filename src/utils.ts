export function camelCaseToKebabCase(str: string): string {
  if (str === str.toUpperCase() && str !== str.toLowerCase()) {
    return str.toLowerCase().replace(/_/g, "-");
  }

  const kebabified = str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return kebabified.replace(/^-/, "").replace(/_/g, "-").replace(/-$/, "");
}
