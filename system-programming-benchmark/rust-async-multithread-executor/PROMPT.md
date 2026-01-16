# Async Runtime Cross-Thread Waker Bug Fix

Please help fix a bug in this Rust async runtime implementation where wakers don't work when called from threads other than the one that originally polled the task.

Run `cargo test test_waker_from_external_thread_should_work` to see the failure.

**Restrictions:**
- Do NOT change the public API (`spawn()`, `run()` functions)
- Do NOT change the `Task`, `RuntimeThread`, or `Scheduler` struct definitions (you may add fields)
- Do NOT change the test cases themselves
- Do NOT change the IoBlocker implementation

You are free to change:
- How tasks are stored when pending
- The TaskWaker implementation
- The create_waker function signature
- How tasks are retrieved and woken
- Internal implementation details

---

## Background: Async Runtime Architecture

This is a multi-threaded work-stealing async runtime that uses mio for I/O event notification.

### Current Architecture

**Task Flow:**
1. Tasks are spawned via `spawn(future)` and assigned to runtime threads
2. RuntimeThreads poll tasks to completion
3. When a task returns `Poll::Pending`, it needs to be stored somewhere
4. When I/O is ready, the waker is called to resume the task

**Components:**
- `Task`: Type-erased future container with ID and I/O metadata
- `TaskWaker`: Implements the Waker vtable to wake tasks
- `RuntimeThread`: Worker thread that executes tasks
- `Scheduler`: Coordinates work across threads
- `IoBlocker`: Handles I/O events using mio::Poll

### The Bug

The current implementation uses **thread-local storage** for pending tasks:

```rust
thread_local! {
    static PENDING_TASKS: RefCell<HashMap<TaskId, Task>> = ...;
}
```

This causes a critical bug: **wakers don't work when called from a different thread** than where the task was originally stored.

**Bug scenario:**
1. Task runs on Thread A, returns `Poll::Pending`
2. Task is stored in Thread A's `PENDING_TASKS`
3. Waker is called from Thread B (e.g., external thread, timer thread)
4. Thread B looks in its own `PENDING_TASKS` (empty!)
5. Task is never found → never wakes up → hangs forever

### Why This Matters

In production async runtimes, wakers must work from **any thread** because:
- Timer threads wake tasks when timeouts expire
- Signal handlers wake tasks from signal threads
- I/O completion threads wake tasks
- External libraries may call wakers from their own threads

### Test Case That Exposes The Bug

```rust
#[test]
fn test_waker_from_external_thread_should_work() {
    // 1. Spawn a task that captures its waker
    spawn(async {
        // Returns Pending and captures waker
    });

    // 2. Call the waker from an EXTERNAL thread (not a runtime thread)
    thread::spawn(move || {
        waker.wake_by_ref();  // ← This should work but currently doesn't!
    });

    // 3. Verify task completed
    assert!(task_completed);  // ← Currently FAILS!
}
```

---

## Requirements

Your fix must:

1. ✅ Make `test_waker_from_external_thread_should_work` pass
2. ✅ Make `test_non_io_task_properly_stored` pass (non-I/O tasks must not be dropped)
3. ✅ Keep all other existing tests passing
4. ✅ Use a thread-safe data structure for pending tasks
5. ✅ Store thread affinity information so tasks can be sent back to their original thread
6. ✅ Make `TaskWaker` able to wake tasks from any thread
