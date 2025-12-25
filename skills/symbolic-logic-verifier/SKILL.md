---
name: symbolic-logic-verifier
description: Verify logical deductions and reasoning chains using TypeScript's type system (Curry-Howard correspondence).
license: MIT
allowed-tools:
  - sandbox_ts
---

# Symbolic Logic Verifier

This skill enables you to verify logical arguments by encoding them as TypeScript types. If the TypeScript compiler (`tsc`) accepts the code, the logic is valid. If it throws a type error, the logic is invalid.

## Theoretical Basis

This relies on the **Curry-Howard correspondence**, where:

- **Propositions** are represented as **Types**.
- **Proofs** are represented as **Programs** (values) of that type.
- If you can construct a value of a specific type, you have proven the proposition.

## Standard Logic Primitive Definitions

When constructing your proof, prepend these standard definitions to your code:

```typescript
// Basic Truth
type True = true;
type False = never;

// Logical Connectives
type Not<P> = P extends True ? False : True;
type And<P, Q> = [P, Q];
type Or<P, Q> = P | Q;
type Implies<P, Q> = (p: P) => Q;
type Iff<P, Q> = And<Implies<P, Q>, Implies<Q, P>>;

// Utility to enforce verification
function assert<_T extends True>() {}
function check<P>(proof: P): void {}
```

## Usage Instructions

To verify a logical chain, you must:

1. Construct a self-contained TypeScript file content string.
2. Use `sandbox_ts` to write this file to the container and compile it.

### Step 1: Formulate the Proof

Define your atomic propositions and your theorem.

**Example: Modus Ponens (If P implies Q, and we have P, then we have Q)**

```typescript
// 1. Define Propositions
type P = { _tag: "P" }; // Unique structural types for atoms
type Q = { _tag: "Q" };

// 2. Define the Theorem (P -> Q) -> P -> Q
type ModusPonens = (implies: (p: P) => Q) => (p: P) => Q;

// 3. Construct the Proof (Implementation)
const proof: ModusPonens = (implies) => (p) => {
  return implies(p);
};
```

### Step 2: Execute Verification

Use the `sandbox_ts` tool to write and compile the proof in the isolated container:

```
sandbox_ts({
  cmd: "cat > /tmp/proof.ts << 'EOF'\n[INSERT TYPESCRIPT CODE HERE]\nEOF\nnpx tsc --noEmit --strict /tmp/proof.ts && echo 'VERIFICATION SUCCESS: Logic is valid.' || echo 'VERIFICATION FAILED: Logic is invalid.'"
})
```

## Examples

### Example 1: Verifying a Valid Syllogism

**Task:** Verify: "All humans are mortal. Socrates is human. Therefore, Socrates is mortal."

**Tool Call:**

```
sandbox_ts({
  cmd: "cat > /tmp/syllogism.ts << 'EOF'\n// Domain Definitions\ntype Human = { _isHuman: true };\ntype Mortal = { _isMortal: true };\ntype Socrates = { _isSocrates: true } & Human;\n\n// Premise 1: All Humans are Mortal\ntype Premise1 = (h: Human) => Mortal;\n\n// Premise 2: Socrates is Human\ntype Premise2 = Socrates extends Human ? true : never;\n\n// Theorem: Socrates is Mortal\ntype Theorem = (p1: Premise1, s: Socrates) => Mortal;\n\n// Proof\nconst proof: Theorem = (allHumansAreMortal, socrates) => {\n    return allHumansAreMortal(socrates);\n};\nEOF\nnpx tsc --noEmit --strict /tmp/syllogism.ts && echo 'VALID'"
})
```

### Example 2: Detecting a Fallacy

**Task:** Verify "Affirming the Consequent": (P -> Q) and Q, therefore P.

**Tool Call:**

```
sandbox_ts({
  cmd: "cat > /tmp/fallacy.ts << 'EOF'\ntype P = { _tag: \"P\" };\ntype Q = { _tag: \"Q\" };\n\n// Theorem: ((P -> Q) AND Q) -> P\ntype Fallacy = (implies: (p: P) => Q, q: Q) => P;\n\n// Attempted Proof\nconst tryProof: Fallacy = (implies, q) => {\n    // There is no way to construct P here given only (P=>Q) and Q.\n    // This return statement will cause a type error.\n    return {} as P;\n};\nEOF\nnpx tsc --noEmit --strict /tmp/fallacy.ts"
})
```

**Expected Output:**
The tool will return an exit code > 0 and TypeScript errors indicating `Conversion of type '{}' to type 'P' may be a mistake`. This confirms the reasoning is invalid.

## Best Practices

1. **Use `--strict`**: Always compile with strict mode to ensure sound reasoning.
2. **Unique Types**: Use `{ _tag: "Name" }` for atomic propositions to prevent TypeScript from treating empty objects as compatible (structural typing).
3. **Self-Contained**: Do not assume any external libraries are installed in the sandbox. Define all logical connectives you need inline.
