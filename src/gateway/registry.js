import { ok, err } from '../types/result.js';

export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    if (!tool.name || typeof tool.name !== 'string') {
      return err({
        code: 'SCHEMA_ERROR',
        message: 'Tool name must be a non-empty string.',
      });
    }

    if (this.tools.has(tool.name)) {
      return err({
        code: 'DUPLICATE_TOOL',
        message: `Tool '${tool.name}' is already registered in this gateway.`,
      });
    }

    this.tools.set(tool.name, tool);
    return ok(undefined);
  }

  get(name) {
    return this.tools.get(name);
  }

  list() {
    return Array.from(this.tools.values());
  }

  validateArguments(name, args) {
    const tool = this.tools.get(name);
    if (!tool) {
      return err({
        code: 'TOOL_NOT_FOUND',
        message: `Requested tool '${name}' does not exist in registry.`,
      });
    }

    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      return err({
        code: 'INVALID_ARGUMENTS',
        message: `Arguments for '${name}' must be an object. Received: ${typeof args}.`,
      });
    }

    const schema = tool.parameters || {};

    if (schema.required && Array.isArray(schema.required)) {
      for (const requiredField of schema.required) {
        if (!(requiredField in args) || args[requiredField] === undefined) {
          return err({
            code: 'INVALID_ARGUMENTS',
            message: `Missing required parameter '${requiredField}' for tool '${name}'.`,
          });
        }
      }
    }

    if (schema.properties) {
      for (const [key, val] of Object.entries(args)) {
        const propSchema = schema.properties[key];
        if (propSchema && propSchema.type) {
          const actualType = typeof val;
          if (propSchema.type === 'string' && actualType !== 'string') {
            return err({
              code: 'INVALID_ARGUMENTS',
              message: `Field '${key}' expected type string, got ${actualType}.`,
            });
          }
          if (propSchema.type === 'number' && actualType !== 'number') {
            return err({
              code: 'INVALID_ARGUMENTS',
              message: `Field '${key}' expected type number, got ${actualType}.`,
            });
          }
          if (propSchema.type === 'boolean' && actualType !== 'boolean') {
            return err({
              code: 'INVALID_ARGUMENTS',
              message: `Field '${key}' expected type boolean, got ${actualType}.`,
            });
          }
        }
      }
    }

    return ok(args);
  }

  toMCPToolList() {
    return this.list().map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters,
    }));
  }
}
