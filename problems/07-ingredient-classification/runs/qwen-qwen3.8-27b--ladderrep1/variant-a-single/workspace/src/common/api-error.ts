/**
 * Single error envelope for the whole API:
 * { "error": { "code": "snake_case", "message": "...", "details": { ... } } }
 * `code` is the contract; `details` is always an object, never null.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const Errors = {
  invalidInput(message: string, details: Record<string, unknown> = {}): ApiError {
    return new ApiError('invalid_input', 400, message, details);
  },

  resourceNotFound(what: string, id: string, details: Record<string, unknown> = {}): ApiError {
    return new ApiError('resource_not_found', 404, `${what} '${id}' was not found.`, { id, ...details });
  },

  noPublishedMethodology(): ApiError {
    return new ApiError(
      'no_published_methodology',
      503,
      'No methodology version is published yet; classify once a version is published.',
      {},
    );
  },

  methodologyImmutable(slug: string, ingredient: string): ApiError {
    return new ApiError(
      'methodology_immutable',
      409,
      `Methodology version '${slug}' is published and immutable; the rule for '${ingredient}' cannot be added or changed.`,
      { slug, ingredient },
    );
  },
};
