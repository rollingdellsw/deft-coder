Please help to fix the test failure of this Rust B-Tree implementation.
Run MIRIFLAGS=-Zmiri-backtrace=full cargo miri test test_interleaved_insert_remove to see the error
Please don't change the struct Node, struct BTreeMap definition, the test case itself, and the public interface, as basic restrictions of this task, besides this, you are free to change any code.

# B-Tree Map Algorithm

B-Tree of order B: each node has [B-1, 2B-1] keys, except root which can have [1, 2B-1] keys. Internal nodes with k keys have k+1 children.

---

## insert(key, value)

1. **Initialize**: If root is None, create an empty root node.

2. **Recursive descent (bottom-up split)**: Call `insert_recursive(root, key, value)`.

3. **Root split**: If the recursive call returns `Some((mid_key, mid_val, new_node))`, create a new root with the promoted key, old root as children[0], and new_node as children[1].

### insert_recursive(node, key, value)

1. **Find position**: Use `find_slot(key)` to locate position.
   - If `Ok(i)`: key exists at index i, update value in place and return `None`.
   - If `Err(i)`: key should go at position i.

2. **If internal node** (children[i] exists):
   - Recursively call `insert_recursive(children[i], key, value)`.
   - If child returns `Some((p_key, p_val, split_node))`:
     1. Insert `p_key, p_val` at position i using `insert_at(i, p_key, p_val)`.
     2. Shift children[i+2..] right by one position.
     3. Set children[i+1] = split_node (the new node with larger keys).
   - If node now has 2B keys (overflow), split and return promoted key/value/new_node.

3. **If leaf node**:
   - Insert (key, value) at position i using `insert_at(i, key, value)`.
   - Increment map length.
   - If node now has 2B keys (overflow), split and return promoted key/value/new_node.

4. Return `None` if no split occurred.

---

## split(node)

Split a node that has overflowed (contains 2B keys, indices 0 to 2B-1):

1. Create a new node (will become right sibling).
2. Copy the last B keys (indices B to 2B-1) and values to the new node.
3. Move the last B+1 children (indices B to 2B) to the new node, if not a leaf.
4. Set original node length to B-1 (keeps keys at indices 0 to B-2).
5. Set new node length to B.
6. Call `extract_middle()` separately to get the median key and value at index B-1 for promotion.
7. Return `(median_key, median_value, new_node)` to caller.

---

## remove(key)

1. If root is None, return None.

2. Call `remove_recursive(root, key)`.

3. **Root shrink**: After remove completes, if root has 0 keys but has a child (children[0].is_some()), make that child the new root.

4. Return the removed value if found.

### remove_recursive(node, key)

1. **Find position**: Use `find_slot(key)` to locate key.

2. **Case: key found at index i** (`Ok(i)`):
   - **If leaf**: Remove key/value at i using `remove_at(i)`, decrement map length, return value.
   - **If internal**:
     1. Read old value at i.
     2. Call `remove_smallest(children[i+1])` to get successor (k, v).
     3. Replace keys[i] and values[i] with successor.
     4. Decrement map length.
     5. Call `fix_underflow(node, i+1)` to rebalance if needed.
     6. Return old value.

3. **Case: key not found** (`Err(i)`):
   - If children[i] exists: recurse into children[i], then call `fix_underflow(node, i)`.
   - Otherwise: return None.

### remove_smallest(node)

Remove and return the smallest key-value pair from the subtree:

1. If leaf: remove and return (key, value) at index 0.
2. If internal: recursively call `remove_smallest(children[0])`, then `fix_underflow(node, 0)`.

---

## fix_underflow(parent, child_idx)

Called after descending/removing from children[child_idx]. If children[child_idx].length < B-1 (underflow):

1. **Borrow from left sibling (rotate_right)**: If child_idx > 0 and children[child_idx - 1].length >= B:
   - Call `rotate_right(parent, child_idx)`.

2. **Borrow from right sibling (rotate_left)**: Else if child_idx < parent.length and children[child_idx + 1].length >= B:
   - Call `rotate_left(parent, child_idx)`.

3. **Merge**: Else (siblings have exactly B-1 keys or only one sibling exists):
   - If child_idx > 0: call `merge_with_left(parent, child_idx)`.
   - Else: call `merge_with_right(parent, child_idx)`.

---

## rotate_right(parent, child_idx)

Borrow from left sibling to fix underflow in children[child_idx]:

1. Extract separator key/value from parent.keys[child_idx - 1].
2. Extract last key/value from left sibling (at index left_len - 1), decrement left sibling length.
3. Move extracted left sibling key/value up to parent.keys[child_idx - 1].
4. Shift all keys/values in child right by 1.
5. Insert separator key/value at child.keys[0].
6. If internal node: shift child's children right by 1, move left sibling's rightmost child to child.children[0].

---

## rotate_left(parent, child_idx)

Borrow from right sibling to fix underflow in children[child_idx]:

1. Extract separator key/value from parent.keys[child_idx].
2. Extract first key/value from right sibling (at index 0).
3. Shift right sibling's keys/values left by 1, decrement right sibling length.
4. Move extracted right sibling key/value up to parent.keys[child_idx].
5. Append separator key/value to end of child.
6. If internal node: move right sibling's first child (children[0]) to end of child, shift right sibling's children left.

---

## merge_with_left(parent, child_idx)

Merge children[child_idx] into children[child_idx - 1]:

1. Extract separator key/value from parent.keys[child_idx - 1].
2. Append separator key/value to left sibling.
3. Copy all keys/values from child to left sibling.
4. If internal: move all children from child to left sibling.
5. Set child.length = 0 to prevent double-free on drop.
6. Shift parent's keys/values left starting at child_idx - 1.
7. Shift parent's children left starting at child_idx (removing the merged child slot).
8. Decrement parent.length.

---

## merge_with_right(parent, child_idx)

Merge children[child_idx + 1] into children[child_idx]:

1. Extract separator key/value from parent.keys[child_idx].
2. Append separator key/value to child.
3. Copy all keys/values from right sibling to child.
4. If internal: move all children from right sibling to child.
5. Set right_sibling.length = 0 to prevent double-free on drop.
6. Shift parent's keys/values left starting at child_idx.
7. Shift parent's children left starting at child_idx + 1 (removing the right sibling slot).
8. Decrement parent.length.
