---
name: csharp-code-style
description: C# and .NET code style standards covering modern language features (records, nullable reference types, LINQ), Microsoft naming conventions, async-first patterns, dependency injection, and structured logging
---

# C# Code Style Guide

## Overview
This guide establishes code style standards for C# and .NET projects. The goal is consistency, maintainability, and leveraging modern language features.

> **Dependency versions and target frameworks are examples only.** The `.csproj` snippets in this skill illustrate structure and package choices. When creating a project, use the latest stable version of each package or SDK unless a compatibility constraint requires pinning. Do not copy the example versions verbatim.

## Naming Conventions (Microsoft Standard)

| Type | Convention | Example |
|------|-----------|---------|
| **Classes, structs, records** | PascalCase | `UserService`, `DatabaseConnection` |
| **Interfaces** | PascalCase with `I` prefix | `IUserRepository`, `IDataStore` |
| **Methods** | PascalCase | `GetUserById`, `CalculateTotal` |
| **Properties** | PascalCase | `FirstName`, `IsActive` |
| **Public fields** | PascalCase | `MaxRetryCount` |
| **Private fields** | `_camelCase` | `_userRepository`, `_logger` |
| **Local variables** | camelCase | `userData`, `totalCount` |
| **Method parameters** | camelCase | `userId`, `firstName` |
| **Constants** | PascalCase | `MaxRetryAttempts`, `DefaultTimeout` |
| **Enum members** | PascalCase | `Pending`, `Approved`, `Rejected` |

## Modern Language Features

### Records (C# 9+)

✅ **DO**: Use records for immutable data containers
```csharp
public record UserDto(string Id, string Name, string Email);

// With additional properties
public record Product
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public decimal Price { get; init; }
}
```

❌ **DON'T**: Use classes for simple data transfer objects
```csharp
public class UserDto // Use a record instead
{
    public string Id { get; set; }
    public string Name { get; set; }
}
```

### Nullable Reference Types

✅ **DO**: Enable nullable reference types and handle nulls explicitly
```csharp
// In .csproj: <Nullable>enable</Nullable>

public User? GetUserById(string id)
{
    return _repository.Find(id); // May return null
}

// Usage with null checking
if (GetUserById(id) is { } user)
{
    return Ok(user);
}
return NotFound();

// Required properties
public record Config
{
    public required string ConnectionString { get; init; }
    public string? OptionalFlag { get; init; }
}
```

### LINQ Patterns

✅ **DO**: Use LINQ for querying collections
```csharp
var activeUsers = users
    .Where(u => u.IsActive)
    .OrderBy(u => u.LastName)
    .Select(u => new UserSummary(u.Id, u.FullName))
    .ToList();

// Method syntax preferred over query syntax
var result = products
    .Where(p => p.Price > 100)
    .GroupBy(p => p.Category)
    .Select(g => new { Category = g.Key, Count = g.Count() });
```

❌ **DON'T**: Mix imperative loops with LINQ
```csharp
var result = new List<User>();
foreach (var user in users) // Use LINQ instead
{
    if (user.IsActive) result.Add(user);
}
```

## Async/Await Patterns

✅ **DO**: Use async/await throughout the call stack
```csharp
public async Task<User> GetUserAsync(string userId)
{
    return await _repository.GetByIdAsync(userId);
}

// Async all the way — no .Result or .Wait()
public async Task<IResult> HandleAsync(string id)
{
    var user = await _userService.GetUserAsync(id);
    return user is null ? Results.NotFound() : Results.Ok(user);
}
```

❌ **DON'T**: Block on async code
```csharp
var user = _repository.GetByIdAsync(id).Result; // Deadlock risk!
var user = _repository.GetByIdAsync(id).GetAwaiter().GetResult(); // Also bad
```

### Cancellation Tokens

✅ **DO**: Accept and forward CancellationToken
```csharp
public async Task<User> GetUserAsync(string id, CancellationToken ct = default)
{
    return await _repository.GetByIdAsync(id, ct);
}

// In controllers
public async Task<IActionResult> Get(string id, CancellationToken ct)
{
    var user = await _userService.GetUserAsync(id, ct);
    return user is null ? NotFound() : Ok(user);
}
```

## Dependency Injection

✅ **DO**: Use constructor injection
```csharp
public class UserService(IUserRepository userRepository, ILogger<UserService> logger)
{
    private readonly IUserRepository _userRepository = userRepository;
    private readonly ILogger<UserService> _logger = logger;
}
```

For C# 11 and below, or when you need validation/init logic in the constructor, use the classic form:

```csharp
public class UserService
{
    private readonly IUserRepository _userRepository;
    private readonly ILogger<UserService> _logger;

    public UserService(IUserRepository userRepository, ILogger<UserService> logger)
    {
        _userRepository = userRepository;
        _logger = logger;
    }
}
```

✅ **DO**: Register services with appropriate lifetime
```csharp
// Singleton — single instance for app lifetime
builder.Services.AddSingleton<ICacheService, MemoryCacheService>();

// Scoped — one instance per request (default for ASP.NET)
builder.Services.AddScoped<IUserRepository, UserRepository>();

// Transient — new instance every injection
builder.Services.AddTransient<IEmailService, EmailService>();
```

❌ **DON'T**: Use service locator or `new` for dependencies
```csharp
public class UserService
{
    public UserService()
    {
        // Bad: hidden dependency
        _repository = new UserRepository();
    }
}
```

## Structured Logging

✅ **DO**: Use structured logging with semantic properties
```csharp
public async Task<User> CreateUserAsync(CreateUserRequest request)
{
    _logger.LogInformation(
        "Creating user with email {Email} at {Timestamp}",
        request.Email,
        DateTime.UtcNow);

    try
    {
        var user = new User { Email = request.Email };
        await _repository.AddAsync(user);
        _logger.LogInformation("User {UserId} created successfully", user.Id);
        return user;
    }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Failed to create user with email {Email}", request.Email);
        throw;
    }
}
```

❌ **DON'T**: Use string interpolation in logs
```csharp
_logger.LogInformation($"Creating user {request.Email}"); // Loses structured data
```

## Code Organization

### Project Structure (Clean Architecture style)
```
src/
  Domain/
    Entities/
    ValueObjects/
    Interfaces/
  Application/
    Services/
    DTOs/
    Interfaces/
  Infrastructure/
    Persistence/
    ExternalServices/
  WebApi/
    Controllers/
    Middleware/
tests/
  Domain.Tests/
  Application.Tests/
  IntegrationTests/
```

### File Organization
```csharp
// One type per file (except nested private types)
// File: UserService.cs

namespace YourApp.Application.Services;

public class UserService
{
    // Private fields
    private readonly IUserRepository _userRepository;

    // Constructor
    public UserService(IUserRepository userRepository) { ... }

    // Public methods
    public async Task<User> GetByIdAsync(string id) { ... }

    // Private helpers (at bottom)
    private User MapToDto(UserEntity entity) { ... }
}
```

## Error Handling

✅ **DO**: Use custom exception types for domain errors
```csharp
public class NotFoundException : Exception
{
    public NotFoundException(string resource, object id)
        : base($"{resource} with identifier {id} was not found") { }
}

public class ValidationException : Exception
{
    public ValidationException(IReadOnlyCollection<string> errors)
        : base("Validation failed") => Errors = errors;

    public IReadOnlyCollection<string> Errors { get; }
}
```

✅ **DO**: Use Result pattern for expected failures
```csharp
public record Result<T>
{
    public T? Value { get; init; }
    public string? Error { get; init; }
    public bool IsSuccess => Error is null;

    public static Result<T> Success(T value) => new() { Value = value };
    public static Result<T> Failure(string error) => new() { Error = error };
}

// Usage
public async Task<Result<User>> GetUserAsync(string id)
{
    var user = await _repository.FindAsync(id);
    return user is not null
        ? Result<User>.Success(user)
        : Result<User>.Failure("User not found");
}
```

## Testing Patterns

✅ **DO**: Use xUnit + FluentAssertions + NSubstitute
```csharp
public class UserServiceTests
{
    private readonly IUserRepository _repository = Substitute.For<IUserRepository>();
    private readonly UserService _sut;

    public UserServiceTests()
    {
        _sut = new UserService(_repository, NullLogger<UserService>.Instance);
    }

    [Fact]
    public async Task GetByIdAsync_ShouldReturnUser_WhenUserExists()
    {
        var user = new User { Id = "1", Name = "Test" };
        _repository.FindAsync("1").Returns(user);

        var result = await _sut.GetByIdAsync("1");

        result.Should().NotBeNull();
        result.Id.Should().Be("1");
    }

    [Fact]
    public async Task GetByIdAsync_ShouldThrowNotFound_WhenUserMissing()
    {
        _repository.FindAsync("999").Returns((User?)null);

        await FluentActions
            .Awaiting(() => _sut.GetByIdAsync("999"))
            .Should().ThrowAsync<NotFoundException>();
    }
}
```

## Best Practices

1. **Prefer records over classes** for data containers
2. **Enable nullable reference types** in all projects
3. **Use primary constructors** for simple services (C# 12+)
4. **Avoid `var` when type isn't obvious** — prefer explicit types for method returns
5. **Use expression-bodied members** for simple methods/properties
6. **Prefer `is` pattern matching** over equality checks
7. **Use file-scoped namespaces** (C# 10+)
8. **ConfigureAwait(false)** in library code (not in application code)
9. **Throw vs return Result** — use Result for expected failures, exceptions for unexpected ones
10. **Use `required` modifier** for mandatory properties
11. **Prefer immutable types** (`init` setters, `readonly` fields)
12. **Use global usings** for commonly used namespaces
13. **Prefer collection expressions** for simple collections (C# 12+)

### Collection Expressions

✅ **DO**: Use collection expressions where they improve readability
```csharp
// Arrays
int[] numbers = [1, 2, 3, 4, 5];

// Lists
List<string> names = ["Alice", "Bob", "Charlie"];

// Spans
ReadOnlySpan<int> span = [1, 2, 3];

// Empty collections
int[] empty = [];

// Combining collections with the spread operator
int[] combined = [..numbers, ..empty, 6];
```

## .csproj Conventions

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
</Project>
```

---

## Related Skills

| Skill | Covers |
|-------|--------|
| `sparring-deep` | Far-reaching architectural decisions with pre-mortems and trade-off cards |
| `sparring-light` | Quick trade-off scans for localized decisions |
| `project-context` | Capturing project-specific constraints, preferences, and decision log |
