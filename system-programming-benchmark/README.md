# System Programming Benchmark Suite

A comprehensive benchmark suite designed to evaluate LLM performance on senior-level system programming challenges in C, C++, and Rust.

## Overview

This benchmark suite tests an LLM's ability to:

- **Debug and fix** complex system-level bugs
- **Understand and work** with advanced data structures
- **Handle concurrency** and thread safety
- **Reason about performance** and memory safety
- **Work within realistic API constraints**

**Target Audience:** Senior Software Engineers specializing in systems programming (C/C++/Rust)

**Difficulty Level:** Graduate-level to Senior Engineer (5-10 years experience)

---

## Why This Benchmark?

### Beyond Typical Coding Tests

Most LLM coding benchmarks (LeetCode, HumanEval) test:

- ✅ Algorithm implementation
- ✅ Basic problem solving
- ❌ Real-world debugging
- ❌ Complex system architecture
- ❌ Concurrency and thread safety
- ❌ Performance optimization

This benchmark fills that gap by testing realistic system programming scenarios that senior engineers face daily.

### What Makes It Hard

- **Large Codebases:** 10000+ lines to understand
- **Subtle Bugs:** Race conditions, memory safety, architectural flaws
- **Domain Knowledge:** Async runtimes, lock-free structures, D-Bus, etc.
- **Real Constraints:** Work with specific version dependencies, cannot break APIs, must maintain compatibility
- **Multiple Disciplines:** Algorithms + Concurrency + Type Systems + Performance

---

## Initial Results

Recent evaluations have highlighted significant differences in _efficiency_ and _reasoning stability_ between top-tier models.

### 1. Rust B-Tree Map (Data Structure Debugging)

**Challenge:** Fix intricate memory safety and logic bugs in a B-Tree split/merge implementation involving `unsafe` pointers.

| Model              | Success | Tests Passed |   Score    | Token Usage |  Time  | Attempts |
| ------------------ | :-----: | :----------: | :--------: | :---------: | :----: | :------: |
| **Gemini 3 Flash** |   ✅    |     100%     | **98/100** |    ~1.5M    | 8 min  |    1     |
| **GLM-4.7**        |   ✅    |     100%     |  20/100\*  |    ~10M     | 70 min |    5     |

_\*Score penalized for extreme inefficiency and multiple dead loops despite final code correctness._

**Key Findings:**

- **Gemini 3 Flash:** demonstrated exceptional proficiency, solving the "hard" Rust coding challenge in a **single attempt** (~8 minutes). It required minimal context refreshing, effectively acting as a "coding beast" on complex pointer arithmetic.
- **GLM-4.7:** Eventually reached a correct solution but struggled significantly with reasoning loops.
  - _Efficiency Gap:_ Consumed **~7x more tokens** and **~9x more time** than Gemini.
  - _Instability:_ The model entered dead loops (consuming 2.5M tokens without output) and required multiple user interventions/cancellations before stabilizing on the 5th attempt.
  - _Milestone:_ Despite the struggle, it is notable that a model priced at ~1/10th of Opus 4.5 could solve this level of challenge at all (DeepSeek v3.2, Kimi K2 thinking can not even make any meaningful progress), proving the efficacy of the agentic harness.

### 2. Rust Async Runtime (Cross-Thread Waker Bug)

**Challenge:** Debug race conditions in a work-stealing async runtime.

| Model              | Success | Tests Passed | Score  | Token Usage |
| ------------------ | :-----: | :----------: | :----: | :---------: |
| **Gemini 3 Flash** |   ✅    |     9/9      | 95/100 |     ~1M     |
| **GLM-4.7**        |   ❌    |     9/9      | 40/100 |    ~1.5M    |

**Key Findings**:

- Gemini demonstrated deep understanding of Arc/Mutex vtable patterns
- GLM correctly identified the issue but failed on implementation details
- The benchmark effectively differentiated surface-level vs deep understanding

### 3. D-Bus Thread Safety (Race Condition Debugging)

**Challenge:** Diagnose and fix a complex data race in `libsystemd`'s D-Bus connection handling where a mutex was accessed after destruction during connection teardown.

| Model              | Success | Tests Passed |   Score    | Token Usage |  Time  | Attempts |
| ------------------ | :-----: | :----------: | :--------: | :---------: | :----: | :------: |
| **Gemini 3 Flash** |   ✅    |     100%     | **85/100** |    ~800K    | 12 min |    1     |
| **GLM-4.7**        |   ❌    |      0%      |   0/100    |    ~5M+     | 45 min |    5     |

**Key Findings:**

- **Gemini 3 Flash:** Achieved a functional fix on the first attempt but used a "brute force" architectural approach.
  - _Strengths:_ Correctly identified the race on reference counters and state variables. Implemented a working mutex wrapper that passed TSan.
  - _Weaknesses:_ Modified a core project header (`macro.h`) to enforce atomic reference counting globally across the entire project, rather than isolating the change to `sd_bus`. This would likely be rejected in code review for performance impact on unrelated components.
- **GLM-4.7:** Failed completely across 5 attempts.
  - Correctly diagnosed sophisticated race conditions (including destruction order and state flags) but suffered from catastrophic tooling failures. It repeatedly truncated source files when attempting to apply patches, leading to linker errors, and entered unrecoverable loops when patch commands failed.
  - _Outcome:_ It timed out/aborted after consuming significant resources without producing a runnable fix.

---

## Current Test Cases

### 🔓 Open Cases (Available for Evaluation)

#### 1. Rust B-Tree Map - Data Structure Debugging

- **Language:** Rust
- **Domain:** Complex data structures, memory safety
- **Difficulty:** ⭐⭐⭐⭐
- **Type:** Fix failing Miri test (use-after-free bug)
- **Challenge:**
  - Understand B-Tree split/merge algorithms
  - Debug memory safety issues with `MaybeUninit`
  - Fix iterator invalidation bugs
  - Work with `unsafe` Rust correctly
- **Lines of Code:** ~800 lines
- **Estimated Time:** 1-3 hours for senior engineers
- **Files:**
  - `rust-btree-map/src/btree_map.rs`
  - `rust-btree-map/PROMPT.md`

### 🔒 Closed Cases

#### 1. Rust Async Runtime - Cross-Thread Waker Bug

- **Language:** Rust
- **Domain:** Concurrency, async/await, thread safety
- **Difficulty:** ⭐⭐⭐⭐⭐
- **Type:** Fix architectural concurrency bug
- **Challenge:**
  - Debug cross-thread waking failure in async runtime
  - Replace thread-local storage with global concurrent data structures
  - Understand `Send`/`Sync` trait bounds
- **Lines of Code:** ~1200 lines
- **Estimated Time:** 30 minutes to 4 hours depending on experience
- **Files:**
  - `rust-async-runtime/src/runtime.rs`
  - `rust-async-runtime/PROMPT.md`

- **Lock-Free Data Structure:** Implement ABA-safe queue with hazard pointers.
- **D-Bus Integration:** Fix message marshalling and cross-process race conditions in C++.
- **Rust Procedural Macros:** Fix broken `TokenStream` manipulation in a complex derive macro.
- **C++ RAII Resource Manager:** Fix resource leaks and exception safety guarantees in C++20.

---

## Benchmark Structure

Each test case includes:

```text
benchmark-name/
├── PROMPT.md              # Problem description for LLM
├── TESTER_INSTRUCTIONS.md # How to verify solutions
├── src/                   # Source code with bug
├── tests/                 # Test suite
├── Cargo.toml / Makefile  # Build configuration
└── README.md              # Background and context

```

### Scoring Rubric

- **Tier 1: Basic Pass (50-60 points):** All tests pass, compiles, no obvious bugs.
- **Tier 2: Good Solution (60-80 points):** Clean structure, proper error handling, idiomatic code.
- **Tier 3: Excellent Solution (80-100 points):** Production-quality, performance optimized, edge cases handled.
- **Bonus (+1-20):** Deep architectural insights, identifying related issues, performance analysis.

---

## Comparison Matrix

| Benchmark         | Difficulty | Domain Expertise | Real-World | Time (Senior Eng) |
| ----------------- | ---------- | ---------------- | ---------- | ----------------- |
| **B-Tree Map**    | ⭐⭐⭐⭐⭐ | Data structures  | ⭐⭐⭐⭐   | 2-8 hours         |
| **Async Runtime** | ⭐⭐⭐⭐⭐ | Concurrency      | ⭐⭐⭐⭐⭐ | 2-8 hours         |
| **Lock-Free DS**  | ⭐⭐⭐⭐⭐ | Performance      | ⭐⭐⭐⭐⭐ | 2-8 hours         |
| **D-Bus**         | ⭐⭐⭐⭐   | IPC              | ⭐⭐⭐⭐⭐ | 1-4 hours         |
| **Proc Macros**   | ⭐⭐⭐⭐   | Metaprogramming  | ⭐⭐⭐⭐   | 1-4 hours         |

---

## Installation & Setup

### Requirements

- **Rust Tests:** `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- `rustup toolchain install nightly --component miri`

- **C++ Tests:** `sudo apt-get install build-essential clang cmake`

### Running Tests

```bash
cd benchmark-name/
cargo test  # For Rust
make test   # For C/C++

```

See individual `TESTER_INSTRUCTIONS.md` for details.

---

## Citation

If you use this benchmark in research, please cite:

```bibtex
@misc{system-programming-benchmark-2026,
  title={System Programming Benchmark Suite for Large Language Models},
  author={[Dan Tian]},
  year={2026},
  howpublished={\url{[https://github.com/rollingdellsw/deft-coder/system-programming-benchmark](https://github.com/rollingdellsw/deft-coder/system-programming-benchmark)}}
}

```

**Last Updated:** January 2026
**Version:** 1.0.6
**Status:** Active Development
