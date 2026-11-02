# Contributing Guide

## Code Style

### TypeScript

- Use explicit types for function parameters and return values
- Prefer interfaces over types for object shapes
- Use `const` by default, `let` only when needed
- No `any` types - use `unknown` if type is truly unknown

### React

- Functional components only
- Use hooks for state management
- Memoize callbacks with `useCallback`
- Memoize expensive computations with `useMemo`
- Component files should be PascalCase: `ResultCard.tsx`

### File Organization

```
ComponentName/
  ComponentName.tsx    # Component implementation
  ComponentName.test.ts # Tests
  index.ts             # Re-export
```

Or for simple components:
```
ComponentName.tsx      # Component with tests in __tests__ folder
```

### Comments

Use JSDoc style for public APIs:

```typescript
/**
 * Compress a single file using extreme compression.
 * @param file - The file to compress
 * @returns Compression result with data and stats
 */
async function compress(file: File): Promise<CompressionResult> {
  // Implementation
}
```

### Naming Conventions

- **Components**: PascalCase (`ResultCard`)
- **Hooks**: camelCase with `use` prefix (`useCompression`)
- **Utils**: camelCase (`formatFileSize`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_FILE_SIZE`)
- **Types/Interfaces**: PascalCase (`CompressionResult`)

## Testing

### Test Structure

```typescript
describe('ComponentName', () => {
  describe('feature', () => {
    it('should do something specific', () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

### Running Tests

```bash
npm test                    # Run all tests
npm test -- --watch         # Watch mode
npm test -- --coverage      # With coverage
npm test -- --run <file>    # Specific file
```

## Git Workflow

1. Create feature branch from `main`
2. Make changes with clear commit messages
3. Run tests and ensure they pass
4. Create pull request

### Commit Messages

Format: `type: description`

Types:
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code change that neither fixes nor adds
- `docs`: Documentation only
- `test`: Adding or updating tests
- `chore`: Build process or auxiliary tool changes

Examples:
```
feat: add extreme compression mode
fix: prevent result card from disappearing
refactor: simplify compression hook
docs: update README with architecture
```

## Architecture Decisions

### Why No Server?

All compression happens in the browser for:
- Privacy (no data leaves the device)
- Speed (no upload/download latency)
- Offline support
- Cost (no server infrastructure)

### Why Web Workers?

- Prevent UI blocking during compression
- Utilize multiple CPU cores
- Handle large files without crashing

### Why 3-Layer Compression?

1. **Deduplication**: Handles repeated data blocks
2. **Delta**: Handles sequential/similar data
3. **LZ77**: General-purpose compression

This combination achieves better ratios than single-algorithm approaches.

## Performance Guidelines

- Chunk large files (64MB chunks for 10TB files)
- Use streaming for files > 1GB
- Limit memory usage to ~512MB per operation
- Yield to event loop every 100ms for responsiveness
