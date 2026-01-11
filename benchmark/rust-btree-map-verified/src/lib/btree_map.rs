//! A B-Tree map implementation.
#![warn(missing_docs)]

use std::borrow::Borrow;
use std::cell::RefCell;
use std::ptr;
use std::rc::Rc;

mod btree_iter;
mod btree_node;

use btree_iter::{Iter, IterMut};
use btree_node::{Node, B};

/// A B-Tree map with ordered keys.
pub struct BTreeMap<K, V> {
    root: Option<Rc<RefCell<Node<K, V>>>>,
    length: usize,
}

impl<K, V> BTreeMap<K, V> {
    /// Creates a new empty BTreeMap.
    pub fn new() -> Self {
        BTreeMap {
            root: None,
            length: 0,
        }
    }

    /// Returns the number of elements in the map.
    pub fn len(&self) -> usize {
        self.length
    }
    /// Returns true if the map contains no elements.
    pub fn is_empty(&self) -> bool {
        self.length == 0
    }
}

impl<K, V> Default for BTreeMap<K, V> {
    fn default() -> Self {
        Self::new()
    }
}

impl<K, V> BTreeMap<K, V>
where
    K: Ord,
{
    /// Returns a reference to the value corresponding to the key.
    pub fn get<Q: ?Sized + Ord>(&self, key: &Q) -> Option<&V>
    where
        K: Borrow<Q>,
    {
        let mut current = self.root.clone();
        while let Some(node_ref) = current {
            let node = RefCell::borrow(&node_ref);
            match node.find_slot(key) {
                Ok(idx) => unsafe { return Some(&*node.values[idx].as_ptr()) },
                Err(idx) => {
                    current = node.children[idx].clone();
                }
            }
        }
        None
    }

    /// Returns a mutable reference to the value corresponding to the key.
    pub fn get_mut<Q: ?Sized + Ord>(&mut self, key: &Q) -> Option<&mut V>
    where
        K: Borrow<Q>,
    {
        let mut current = self.root.clone();
        while let Some(node_ref) = current {
            let idx = {
                let mut node = RefCell::borrow_mut(&node_ref);
                match node.find_slot(key) {
                    Ok(i) => {
                        let ptr = node.values[i].as_mut_ptr();
                        drop(node);
                        return unsafe { Some(&mut *ptr) };
                    }
                    Err(i) => i,
                }
            };
            current = RefCell::borrow(&node_ref).children[idx].clone();
        }
        None
    }

    /// Inserts a key-value pair into the map.
    /// Returns the old value if the key was already present.
    pub fn insert(&mut self, key: K, value: V) -> Option<V> {
        if self.root.is_none() {
            self.root = Some(Rc::new(RefCell::new(Node::new())));
        }

        let result = self.insert_recursive(self.root.clone().unwrap(), key, value);
        if let Some((mid_key, mid_val, new_node)) = result {
            // Root split
            let mut new_root = Node::new();
            new_root.keys[0].write(mid_key);
            new_root.values[0].write(mid_val);
            new_root.length = 1;
            new_root.children[0] = self.root.take();
            new_root.children[1] = Some(Rc::new(RefCell::new(new_node)));
            self.root = Some(Rc::new(RefCell::new(new_root)));
            None
        } else {
            None // Handled in recursive
        }
    }

    fn insert_recursive(
        &mut self,
        node_ref: Rc<RefCell<Node<K, V>>>,
        key: K,
        value: V,
    ) -> Option<(K, V, Node<K, V>)> {
        let mut node = node_ref.borrow_mut();
        let idx = match node.find_slot(&key) {
            Ok(i) => {
                unsafe { node.values[i].assume_init_drop() }; // Drop old value
                node.values[i].write(value);
                return None;
            }
            Err(i) => i,
        };

        // Insert or recurse
        if node.children[idx].is_some() {
            let child = node.children[idx].clone().unwrap();
            drop(node);
            if let Some((p_key, p_val, split_node)) = self.insert_recursive(child, key, value) {
                // Child split, promote middle up to here
                let mut node = node_ref.borrow_mut();

                node.insert_at(idx, p_key, p_val);
                // The split_node contains larger keys, becomes child at idx+1
                // Shift children right to make room for new child at idx+1
                for i in (idx + 2..=node.length as usize).rev() {
                    node.children[i] = node.children[i - 1].take();
                }
                node.children[idx + 1] = Some(Rc::new(RefCell::new(split_node)));

                if node.length as usize >= 2 * B {
                    let new_node = node.split();
                    let (mid_key, mid_val) = node.extract_middle();
                    return Some((mid_key, mid_val, new_node));
                }
            }
        } else {
            // Leaf
            node.insert_at(idx, key, value);
            self.length += 1;
            if node.length as usize >= 2 * B {
                let new_node = node.split();
                let (mid_key, mid_val) = node.extract_middle();
                return Some((mid_key, mid_val, new_node));
            }
        }
        None
    }

    /// Removes a key from the map, returning the value if it was present.
    pub fn remove<Q: ?Sized + Ord>(&mut self, key: &Q) -> Option<V>
    where
        K: Borrow<Q>,
    {
        self.root.as_ref()?;

        let ret = self.remove_recursive(self.root.clone().unwrap(), key);

        // Clean up root if empty
        if let Some(ref r) = self.root {
            let r = RefCell::borrow(r);
            if r.length == 0 && r.children[0].is_some() {
                let new_root = r.children[0].clone();
                drop(r);
                self.root = new_root;
            }
        }
        ret
    }

    fn remove_recursive<Q: ?Sized + Ord>(
        &mut self,
        node_ref: Rc<RefCell<Node<K, V>>>,
        key: &Q,
    ) -> Option<V>
    where
        K: Borrow<Q>,
    {
        let mut node = node_ref.borrow_mut();
        let idx = match node.find_slot(key) {
            Ok(i) => {
                // Found in this node
                if node.is_leaf() {
                    let v = node.remove_at(i).1;
                    self.length -= 1;
                    return Some(v);
                } else {
                    // Internal node: replace with successor
                    let old_val = unsafe { node.values[i].assume_init_read() };
                    let (succ_k, succ_v) =
                        self.remove_smallest(&node.children[i + 1].clone().unwrap());
                    unsafe { ptr::write(node.keys[i].as_mut_ptr(), succ_k) };
                    node.values[i].write(succ_v);
                    drop(node);
                    self.length -= 1;
                    self.fix_underflow(&node_ref, i + 1);
                    return Some(old_val);
                }
            }
            Err(i) => i,
        };

        if node.children[idx].is_some() {
            drop(node);
            let child = RefCell::borrow(&node_ref).children[idx].clone().unwrap();
            let ret = self.remove_recursive(child, key);
            self.fix_underflow(&node_ref, idx);
            ret
        } else {
            None
        }
    }

    fn remove_smallest(&mut self, node_ref: &Rc<RefCell<Node<K, V>>>) -> (K, V) {
        let mut node = node_ref.borrow_mut();
        if node.is_leaf() {
            return node.remove_at(0);
        }
        let child = node.children[0].clone().unwrap();
        drop(node);
        let ret = self.remove_smallest(&child);
        self.fix_underflow(node_ref, 0);
        ret
    }

    fn fix_underflow(&mut self, node_ref: &Rc<RefCell<Node<K, V>>>, child_idx: usize) {
        let child_len = {
            let node = RefCell::borrow(node_ref);
            node.children[child_idx]
                .as_ref()
                .map(|c| RefCell::borrow(c).length)
                .unwrap_or(0)
        };

        if child_len >= (B - 1) as u16 {
            return;
        }

        let node_len = RefCell::borrow(node_ref).length as usize;

        // Try rotate from left sibling
        if child_idx > 0 {
            let left_len = {
                let node = RefCell::borrow(node_ref);
                node.children[child_idx - 1]
                    .as_ref()
                    .map(|c| RefCell::borrow(c).length)
                    .unwrap_or(0)
            };
            if left_len >= B as u16 {
                self.rotate_right(node_ref, child_idx);
                return;
            }
        }

        // Try rotate from right sibling
        if child_idx < node_len {
            let right_len = {
                let node = RefCell::borrow(node_ref);
                node.children[child_idx + 1]
                    .as_ref()
                    .map(|c| RefCell::borrow(c).length)
                    .unwrap_or(0)
            };
            if right_len >= B as u16 {
                self.rotate_left(node_ref, child_idx);
                return;
            }
        }

        // Merge with a sibling
        if child_idx > 0 {
            self.merge_with_left(node_ref, child_idx);
        } else {
            self.merge_with_right(node_ref, child_idx);
        }
    }

    fn rotate_right(&mut self, node_ref: &Rc<RefCell<Node<K, V>>>, child_idx: usize) {
        let left_sibling = RefCell::borrow(node_ref).children[child_idx - 1]
            .clone()
            .unwrap();
        let left_len = RefCell::borrow(&left_sibling).length as usize;

        let (sep_key, sep_val) = {
            let node = node_ref.borrow_mut();
            unsafe {
                let k = node.keys[child_idx - 1].assume_init_read();
                let v = node.values[child_idx - 1].assume_init_read();
                (k, v)
            }
        };

        let (left_key, left_val) = {
            let mut left = left_sibling.borrow_mut();
            unsafe {
                let k = left.keys[left_len - 1].assume_init_read();
                let v = left.values[left_len - 1].assume_init_read();
                left.length -= 1;
                (k, v)
            }
        };

        {
            let mut node = node_ref.borrow_mut();
            node.keys[child_idx - 1].write(left_key);
            node.values[child_idx - 1].write(left_val);
        }

        let child = RefCell::borrow(node_ref).children[child_idx]
            .clone()
            .unwrap();
        {
            let mut child_node = child.borrow_mut();
            let child_len = child_node.length as usize;
            unsafe {
                // Do keys copy first
                let keys_ptr = child_node.keys.as_mut_ptr();
                ptr::copy(keys_ptr, keys_ptr.add(1), child_len);
                child_node.keys[0].write(sep_key);
                // Now do values copy
                let values_ptr = child_node.values.as_mut_ptr();
                ptr::copy(values_ptr, values_ptr.add(1), child_len);
                child_node.values[0].write(sep_val);
                child_node.length += 1;
            }
            if !child_node.is_leaf() {
                for i in (1..=child_len + 1).rev() {
                    child_node.children[i] = child_node.children[i - 1].take();
                }
                // Take the rightmost child from left sibling (at old left_len, which is now beyond its new length)
                let left_child = left_sibling.borrow_mut().children[left_len].take();
                child_node.children[0] = left_child;
            }
        }
    }

    fn rotate_left(&mut self, node_ref: &Rc<RefCell<Node<K, V>>>, child_idx: usize) {
        let right_sibling = RefCell::borrow(node_ref).children[child_idx + 1]
            .clone()
            .unwrap();

        let (sep_key, sep_val) = {
            let node = node_ref.borrow_mut();
            unsafe {
                let k = node.keys[child_idx].assume_init_read();
                let v = node.values[child_idx].assume_init_read();
                (k, v)
            }
        };

        let (right_key, right_val) = {
            let mut right = right_sibling.borrow_mut();
            unsafe {
                let k = right.keys[0].assume_init_read();
                let v = right.values[0].assume_init_read();
                let right_len = right.length as usize;
                // Do keys copy first, completely finish with it
                let keys_ptr = right.keys.as_mut_ptr();
                ptr::copy(keys_ptr.add(1), keys_ptr, right_len - 1);
                // Now do values copy
                let values_ptr = right.values.as_mut_ptr();
                ptr::copy(values_ptr.add(1), values_ptr, right_len - 1);
                right.length -= 1;
                (k, v)
            }
        };

        {
            let mut node = node_ref.borrow_mut();
            node.keys[child_idx].write(right_key);
            node.values[child_idx].write(right_val);
        }

        let child = RefCell::borrow(node_ref).children[child_idx]
            .clone()
            .unwrap();
        {
            let mut child_node = child.borrow_mut();
            let child_len = child_node.length as usize;
            child_node.keys[child_len].write(sep_key);
            child_node.values[child_len].write(sep_val);
            child_node.length += 1;
            if !child_node.is_leaf() {
                let right_len = RefCell::borrow(&right_sibling).length as usize;
                let mut right_mut = right_sibling.borrow_mut();
                // Take the leftmost child from right sibling
                let right_child = right_mut.children[0].take();
                child_node.children[child_len + 1] = right_child;
                // Shift right sibling's children left
                for i in 0..=right_len {
                    right_mut.children[i] = right_mut.children[i + 1].take();
                }
            }
        }
    }

    fn merge_with_left(&mut self, node_ref: &Rc<RefCell<Node<K, V>>>, child_idx: usize) {
        let left_sibling = RefCell::borrow(node_ref).children[child_idx - 1]
            .clone()
            .unwrap();
        let child = RefCell::borrow(node_ref).children[child_idx]
            .clone()
            .unwrap();

        let (sep_key, sep_val) = {
            let node = node_ref.borrow_mut();
            unsafe {
                let k = node.keys[child_idx - 1].assume_init_read();
                let v = node.values[child_idx - 1].assume_init_read();
                (k, v)
            }
        };

        {
            let mut left_mut = left_sibling.borrow_mut();
            let child_node = RefCell::borrow(&child);
            let left_len = left_mut.length as usize;
            let child_len = child_node.length as usize;
            unsafe {
                left_mut.keys[left_len].write(sep_key);
                left_mut.values[left_len].write(sep_val);
                ptr::copy_nonoverlapping(
                    child_node.keys.as_ptr(),
                    left_mut.keys.as_mut_ptr().add(left_len + 1),
                    child_len,
                );
                ptr::copy_nonoverlapping(
                    child_node.values.as_ptr(),
                    left_mut.values.as_mut_ptr().add(left_len + 1),
                    child_len,
                );
                left_mut.length = (left_len + 1 + child_len) as u16;
            }
            if !left_mut.is_leaf() {
                drop(child_node);
                let mut child_mut = child.borrow_mut();
                for i in 0..=child_len {
                    left_mut.children[left_len + 1 + i] = child_mut.children[i].take();
                }
            } else {
                drop(child_node);
            }
        }

        // Clear the child's length to prevent double-free on drop
        child.borrow_mut().length = 0;

        let mut node = node_ref.borrow_mut();
        let node_len = node.length as usize;
        unsafe {
            // Do keys first
            let keys_ptr = node.keys.as_mut_ptr();
            ptr::copy(
                keys_ptr.add(child_idx),
                keys_ptr.add(child_idx - 1),
                node_len - child_idx,
            );
            // Now do values
            let values_ptr = node.values.as_mut_ptr();
            ptr::copy(
                values_ptr.add(child_idx),
                values_ptr.add(child_idx - 1),
                node_len - child_idx,
            );
        }
        for i in child_idx..=node_len {
            node.children[i] = node.children[i + 1].take();
        }
        node.length -= 1;
    }

    fn merge_with_right(&mut self, node_ref: &Rc<RefCell<Node<K, V>>>, child_idx: usize) {
        let child = RefCell::borrow(node_ref).children[child_idx]
            .clone()
            .unwrap();
        let right_sibling = RefCell::borrow(node_ref).children[child_idx + 1]
            .clone()
            .unwrap();

        let (sep_key, sep_val) = {
            let node = node_ref.borrow_mut();
            unsafe {
                let k = node.keys[child_idx].assume_init_read();
                let v = node.values[child_idx].assume_init_read();
                (k, v)
            }
        };

        {
            let mut child_mut = child.borrow_mut();
            let right_node = RefCell::borrow(&right_sibling);
            let child_len = child_mut.length as usize;
            let right_len = right_node.length as usize;
            unsafe {
                child_mut.keys[child_len].write(sep_key);
                child_mut.values[child_len].write(sep_val);
                ptr::copy_nonoverlapping(
                    right_node.keys.as_ptr(),
                    child_mut.keys.as_mut_ptr().add(child_len + 1),
                    right_len,
                );
                ptr::copy_nonoverlapping(
                    right_node.values.as_ptr(),
                    child_mut.values.as_mut_ptr().add(child_len + 1),
                    right_len,
                );
                child_mut.length = (child_len + 1 + right_len) as u16;
            }
            if !child_mut.is_leaf() {
                drop(right_node);
                let mut right_mut = right_sibling.borrow_mut();
                for i in 0..=right_len {
                    child_mut.children[child_len + 1 + i] = right_mut.children[i].take();
                }
            } else {
                drop(right_node);
            }
        }

        // Clear the right sibling's length to prevent double-free on drop
        right_sibling.borrow_mut().length = 0;

        let mut node = node_ref.borrow_mut();
        let node_len = node.length as usize;
        unsafe {
            // Do keys first
            let keys_ptr = node.keys.as_mut_ptr();
            ptr::copy(
                keys_ptr.add(child_idx + 1),
                keys_ptr.add(child_idx),
                node_len - child_idx - 1,
            );
            // Now do values
            let values_ptr = node.values.as_mut_ptr();
            ptr::copy(
                values_ptr.add(child_idx + 1),
                values_ptr.add(child_idx),
                node_len - child_idx - 1,
            );
        }
        for i in (child_idx + 1)..=node_len {
            node.children[i] = node.children[i + 1].take();
        }
        node.length -= 1;
    }
}

impl<'a, K, V> IntoIterator for &'a BTreeMap<K, V> {
    type Item = (&'a K, &'a V);
    type IntoIter = Iter<'a, K, V>;
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<'a, K, V> IntoIterator for &'a mut BTreeMap<K, V> {
    type Item = (&'a K, &'a mut V);
    type IntoIter = IterMut<'a, K, V>;
    fn into_iter(self) -> Self::IntoIter {
        self.iter_mut()
    }
}

impl<K, V> BTreeMap<K, V> {
    /// Returns an iterator over the key-value pairs.
    pub fn iter(&self) -> Iter<'_, K, V> {
        Iter::new(self.root.clone())
    }
    /// Returns a mutable iterator over the key-value pairs.
    pub fn iter_mut(&mut self) -> IterMut<'_, K, V> {
        IterMut::new(self.root.clone())
    }

    #[cfg(test)]
    /// Performs a breadth-first traversal of the B-Tree for testing purposes.
    pub fn bfs(&self, result: &mut Vec<Vec<Vec<(K, V)>>>)
    where
        K: Clone,
        V: Clone,
    {
        if let Some(ref root) = self.root {
            RefCell::borrow(root).bfs(0, result);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::BTreeMap as StdBTreeMap;

    /// Print tree structure for debugging
    #[allow(dead_code)]
    fn print_btree<K: Clone + std::fmt::Debug, V: Clone + std::fmt::Debug>(map: &BTreeMap<K, V>) {
        let mut result: Vec<Vec<Vec<(K, V)>>> = Default::default();
        map.bfs(&mut result);
        for i in 0..result.len() {
            println!("At layer {}", &i);
            print!("[ ");
            for j in 0..result[i].len() {
                print!("[ ");
                for k in 0..result[i][j].len() {
                    print!("{:?}, ", &result[i][j][k].0);
                }
                print!("] ");
            }
            println!(" ]");
        }
    }

    /// Check B-Tree structural invariants, returns error message if invalid
    fn check_btree_invariants_impl<K: Ord + std::fmt::Debug, V>(
        map: &BTreeMap<K, V>,
    ) -> Result<(), String> {
        if map.root.is_none() {
            if map.len() != 0 {
                return Err(format!("Empty root but non-zero length: {}", map.len()));
            }
            return Ok(());
        }

        let root = map.root.as_ref().unwrap();
        let root_node = RefCell::borrow(root);

        // Root can have 0 keys only if it's also a leaf (empty tree case handled above)
        // Otherwise root must have at least 1 key
        if !root_node.is_leaf() {
            if root_node.length < 1 {
                return Err("Internal root must have at least 1 key".to_string());
            }
        }
        if (root_node.length as usize) > 2 * B - 1 {
            return Err(format!("Root has too many keys: {}", root_node.length));
        }

        let mut leaf_depth = None;
        let count = check_node_recursive(&root_node, 0, &mut leaf_depth, true)?;
        if count != map.len() {
            return Err(format!(
                "Counted {} elements but map.len() is {}",
                count,
                map.len()
            ));
        }
        Ok(())
    }

    fn check_node_recursive<K: Ord + std::fmt::Debug, V>(
        node: &Node<K, V>,
        depth: usize,
        leaf_depth: &mut Option<usize>,
        is_root: bool,
    ) -> Result<usize, String> {
        let len = node.length as usize;

        // Non-root nodes must have [B-1, 2B-1] keys
        if !is_root {
            if len < B - 1 {
                return Err(format!(
                    "Node at depth {} has {} keys, minimum is {}",
                    depth,
                    len,
                    B - 1
                ));
            }
        }
        if len > 2 * B - 1 {
            return Err(format!(
                "Node at depth {} has {} keys, maximum is {}",
                depth,
                len,
                2 * B - 1
            ));
        }

        // Check keys are sorted
        for i in 1..len {
            unsafe {
                let prev = &*node.keys[i - 1].as_ptr();
                let curr = &*node.keys[i].as_ptr();
                if prev >= curr {
                    return Err(format!(
                        "Keys not sorted at depth {}: {:?} >= {:?}",
                        depth, prev, curr
                    ));
                }
            }
        }

        if node.is_leaf() {
            match leaf_depth {
                None => *leaf_depth = Some(depth),
                Some(d) => {
                    if *d != depth {
                        return Err(format!("Leaf at depth {} but expected depth {}", depth, d));
                    }
                }
            }
            return Ok(len);
        }

        // Internal node with k keys must have exactly k+1 non-None children
        let mut count = len;
        for i in 0..=len {
            if node.children[i].is_none() {
                return Err(format!(
                    "Internal node at depth {} missing child at index {}",
                    depth, i
                ));
            }
            count += check_node_recursive(
                &RefCell::borrow(node.children[i].as_ref().unwrap()),
                depth + 1,
                leaf_depth,
                false,
            )?;
        }
        // Children beyond len should be None
        for i in (len + 1)..=(2 * B) {
            if node.children[i].is_some() {
                return Err(format!(
                    "Internal node at depth {} has extra child at index {}",
                    depth, i
                ));
            }
        }
        Ok(count)
    }

    /// Check parent-child key ordering invariant
    /// All keys in children[i] must be < keys[i]
    /// All keys in children[i+1] must be > keys[i]
    fn check_key_child_ordering<K: Ord + Clone + std::fmt::Debug, V: Clone>(
        node: &Node<K, V>,
        min_bound: Option<&K>,
        max_bound: Option<&K>,
        depth: usize,
    ) -> Result<(), String> {
        let len = node.length as usize;

        // Check this node's keys are within bounds
        for i in 0..len {
            unsafe {
                let key = &*node.keys[i].as_ptr();
                if let Some(min) = min_bound {
                    if key <= min {
                        return Err(format!(
                            "Key {:?} at depth {} index {} violates min bound {:?}",
                            key, depth, i, min
                        ));
                    }
                }
                if let Some(max) = max_bound {
                    if key >= max {
                        return Err(format!(
                            "Key {:?} at depth {} index {} violates max bound {:?}",
                            key, depth, i, max
                        ));
                    }
                }
            }
        }

        // Recursively check children with updated bounds
        if !node.is_leaf() {
            for i in 0..=len {
                let child = node.children[i].as_ref().unwrap();
                let child_node = RefCell::borrow(child);
                let new_min = if i > 0 {
                    Some(unsafe { &*node.keys[i - 1].as_ptr() })
                } else {
                    min_bound
                };
                let new_max = if i < len {
                    Some(unsafe { &*node.keys[i].as_ptr() })
                } else {
                    max_bound
                };
                check_key_child_ordering(&child_node, new_min, new_max, depth + 1)?;
            }
        }
        Ok(())
    }

    /// Check B-Tree invariants with detailed error output
    fn check_btree_invariants<K: Ord + Clone + std::fmt::Debug, V: Clone + std::fmt::Debug>(
        map: &BTreeMap<K, V>,
        context: &str,
    ) {
        if let Err(e) = check_btree_invariants_impl(map) {
            println!("=== B-Tree Invariant Violation ===");
            println!("Context: {}", context);
            println!("Error: {}", e);
            println!("Tree structure:");
            print_btree(map);
            println!("==================================");
            panic!("B-Tree invariant violated: {}", e);
        }
        // Also check key-child ordering
        if let Some(ref root) = map.root {
            let root_node = RefCell::borrow(root);
            if let Err(e) = check_key_child_ordering(&root_node, None, None, 0) {
                println!("=== Key-Child Ordering Violation ===");
                println!("Context: {}", context);
                println!("Error: {}", e);
                print_btree(map);
                panic!("Key-child ordering violated: {}", e);
            }
        }
    }

    /// Compare our BTreeMap against std::collections::BTreeMap
    /// Returns discrepancies found (empty if none)
    fn compare_with_std_impl<K: Ord + Clone + std::fmt::Debug, V: Eq + Clone + std::fmt::Debug>(
        ours: &BTreeMap<K, V>,
        std_map: &StdBTreeMap<K, V>,
    ) -> Vec<String> {
        let mut errors = Vec::new();

        // Check lengths match
        if ours.len() != std_map.len() {
            errors.push(format!(
                "Length mismatch: ours={}, std={}",
                ours.len(),
                std_map.len()
            ));
        }

        // Check all keys/values from std exist in ours
        for (k, v) in std_map.iter() {
            let our_v = ours.get(k);
            if our_v.is_none() {
                errors.push(format!("Key {:?} exists in std but not in ours", k));
            } else if our_v.unwrap() != v {
                errors.push(format!(
                    "Value mismatch for key {:?}: ours={:?}, std={:?}",
                    k,
                    our_v.unwrap(),
                    v
                ));
            }
        }

        // Check all keys/values from ours exist in std
        for (k, v) in ours.iter() {
            let std_v = std_map.get(k);
            if std_v.is_none() {
                errors.push(format!("Key {:?} exists in ours but not in std", k));
            } else if std_v.unwrap() != v {
                errors.push(format!(
                    "Value mismatch for key {:?}: ours={:?}, std={:?}",
                    k,
                    v,
                    std_v.unwrap()
                ));
            }
        }

        // Check iteration order matches
        let our_keys: Vec<_> = ours.iter().map(|(k, _)| k.clone()).collect();
        let std_keys: Vec<_> = std_map.iter().map(|(k, _)| k.clone()).collect();
        if our_keys != std_keys {
            errors.push(format!(
                "Iteration order mismatch:\n  ours: {:?}\n  std:  {:?}",
                our_keys, std_keys
            ));
        }

        errors
    }

    /// Compare with std and print detailed debug info on mismatch
    fn compare_with_std<K: Ord + Clone + std::fmt::Debug, V: Eq + Clone + std::fmt::Debug>(
        ours: &BTreeMap<K, V>,
        std_map: &StdBTreeMap<K, V>,
        context: &str,
    ) {
        let errors = compare_with_std_impl(ours, std_map);
        if !errors.is_empty() {
            println!("=== Comparison Mismatch with std::BTreeMap ===");
            println!("Context: {}", context);
            for e in &errors {
                println!("  - {}", e);
            }
            println!("Our tree structure:");
            print_btree(ours);
            println!("std keys: {:?}", std_map.keys().collect::<Vec<_>>());
            println!("==============================================");
            panic!("Comparison failed: {} errors found", errors.len());
        }
    }

    // ==================== Basic Tests ====================

    #[test]
    fn test_empty_map() {
        let map: BTreeMap<u32, String> = BTreeMap::new();
        assert!(map.is_empty());
        assert_eq!(map.len(), 0);
        assert!(map.get(&0).is_none());
    }

    #[test]
    fn test_single_insert_remove() {
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        map.insert(42, "hello".to_string());
        std_map.insert(42, "hello".to_string());

        compare_with_std(&map, &std_map, "after insert 42");
        check_btree_invariants(&map, "after insert 42");

        assert_eq!(map.get(&42), Some(&"hello".to_string()));
        assert_eq!(map.remove(&42), Some("hello".to_string()));
        assert!(map.is_empty());
    }

    #[test]
    fn test_update_existing_key() {
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        map.insert(1, "first".to_string());
        std_map.insert(1, "first".to_string());
        compare_with_std(&map, &std_map, "after first insert");

        map.insert(1, "second".to_string());
        std_map.insert(1, "second".to_string());
        compare_with_std(&map, &std_map, "after update");

        assert_eq!(map.get(&1), Some(&"second".to_string()));
    }

    #[test]
    fn test_get_mut() {
        let mut map = BTreeMap::new();
        map.insert(1, 100);

        if let Some(v) = map.get_mut(&1) {
            *v = 200;
        }
        assert_eq!(map.get(&1), Some(&200));
        assert!(map.get_mut(&999).is_none());
    }

    // ==================== Insertion Tests ====================

    #[test]
    fn test_sequential_insert() {
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        for i in 0..100u32 {
            map.insert(i, i + 1);
            std_map.insert(i, i + 1);
            let ctx = format!("after inserting {}", i);
            check_btree_invariants(&map, &ctx);
            compare_with_std(&map, &std_map, &ctx);
        }
    }

    #[test]
    fn test_reverse_insert() {
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        for i in (0..100u32).rev() {
            map.insert(i, i + 1);
            std_map.insert(i, i + 1);
            let ctx = format!("after inserting {}", i);
            check_btree_invariants(&map, &ctx);
            compare_with_std(&map, &std_map, &ctx);
        }
    }

    #[test]
    fn test_interleaved_insert() {
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        // Insert in pattern: 0, 99, 1, 98, 2, 97, ...
        for i in 0..50u32 {
            map.insert(i, i + 1);
            std_map.insert(i, i + 1);
            map.insert(99 - i, 100 - i);
            std_map.insert(99 - i, 100 - i);
            let ctx = format!("after inserting {} and {}", i, 99 - i);
            check_btree_invariants(&map, &ctx);
            compare_with_std(&map, &std_map, &ctx);
        }
    }

    // ==================== Deletion Tests ====================

    #[test]
    fn test_remove_nonexistent() {
        let mut map: BTreeMap<u32, u32> = BTreeMap::new();
        assert!(map.remove(&42).is_none());

        map.insert(1, 1);
        assert!(map.remove(&42).is_none());
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn test_sequential_remove() {
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        for i in 0..100u32 {
            map.insert(i, i + 1);
            std_map.insert(i, i + 1);
        }

        for i in 0..100u32 {
            let ours = map.remove(&i);
            let std = std_map.remove(&i);
            if ours != std {
                println!(
                    "Remove result mismatch for key {}: ours={:?}, std={:?}",
                    i, ours, std
                );
                print_btree(&map);
                panic!("Remove result mismatch");
            }
            let ctx = format!("after removing {}", i);
            check_btree_invariants(&map, &ctx);
            compare_with_std(&map, &std_map, &ctx);
        }

        assert!(map.is_empty());
    }

    #[test]
    fn test_reverse_remove() {
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        for i in 0..100u32 {
            map.insert(i, i + 1);
            std_map.insert(i, i + 1);
        }

        for i in (0..100u32).rev() {
            let ours = map.remove(&i);
            let std = std_map.remove(&i);
            if ours != std {
                println!(
                    "Remove result mismatch for key {}: ours={:?}, std={:?}",
                    i, ours, std
                );
                print_btree(&map);
                panic!("Remove result mismatch");
            }
            let ctx = format!("after removing {}", i);
            check_btree_invariants(&map, &ctx);
            compare_with_std(&map, &std_map, &ctx);
        }

        assert!(map.is_empty());
    }

    #[test]
    fn test_random_remove() {
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        for i in 0..100u32 {
            map.insert(i, i + 1);
            std_map.insert(i, i + 1);
        }

        // Remove in pseudo-random order
        let remove_order: [u32; 100] = [
            73, 12, 45, 89, 23, 67, 1, 98, 34, 56, 78, 90, 5, 43, 21, 87, 65, 32, 10, 99, 54, 76,
            38, 19, 82, 47, 3, 61, 95, 28, 70, 14, 52, 86, 40, 8, 93, 25, 63, 17, 79, 36, 58, 91,
            4, 48, 81, 22, 69, 33, 96, 11, 55, 88, 27, 64, 2, 46, 83, 20, 72, 39, 94, 7, 51, 85,
            30, 68, 13, 59, 92, 26, 71, 37, 84, 9, 50, 80, 24, 66, 35, 97, 6, 44, 77, 18, 62, 31,
            49, 15, 53, 75, 29, 60, 0, 42, 74, 16, 57, 41,
        ];

        for &i in &remove_order {
            let ours = map.remove(&i);
            let std = std_map.remove(&i);
            if ours != std {
                println!(
                    "Remove result mismatch for key {}: ours={:?}, std={:?}",
                    i, ours, std
                );
                print_btree(&map);
                panic!("Remove result mismatch");
            }
            let ctx = format!("after removing {}", i);
            check_btree_invariants(&map, &ctx);
            compare_with_std(&map, &std_map, &ctx);
        }
    }

    // ==================== Mixed Operations Tests ====================

    #[test]
    fn test_interleaved_insert_remove() {
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        for i in 0..50u32 {
            // Insert two
            map.insert(i * 2, i * 2 + 1);
            std_map.insert(i * 2, i * 2 + 1);
            map.insert(i * 2 + 1, i * 2 + 2);
            std_map.insert(i * 2 + 1, i * 2 + 2);

            let ctx = format!("after inserting {} and {}", i * 2, i * 2 + 1);
            check_btree_invariants(&map, &ctx);
            compare_with_std(&map, &std_map, &ctx);

            // Remove one (if possible)
            if i > 0 {
                let key_to_remove = i - 1;
                map.remove(&key_to_remove);
                std_map.remove(&key_to_remove);
                let ctx = format!("after removing {}", key_to_remove);
                check_btree_invariants(&map, &ctx);
                compare_with_std(&map, &std_map, &ctx);
            }
        }
    }

    // ==================== Iterator Tests ====================

    #[test]
    fn test_iter() {
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        for i in [5u32, 2, 8, 1, 9, 3, 7, 4, 6, 0] {
            map.insert(i, i + 1);
            std_map.insert(i, i + 1);
        }

        let mut prev_k = None;
        for (k, v) in map.iter() {
            assert_eq!(*v, k + 1);
            if let Some(prev) = prev_k {
                assert!(prev < *k, "Iterator not in sorted order");
            }
            prev_k = Some(*k);
        }

        let our_items: Vec<_> = map.iter().collect();
        let std_items: Vec<_> = std_map.iter().collect();
        assert_eq!(our_items.len(), std_items.len());
    }

    #[test]
    fn test_iter_mut() {
        let mut map = BTreeMap::new();

        for i in 0..10u32 {
            map.insert(i, i);
        }

        // Double all values
        for (_, v) in map.iter_mut() {
            *v *= 2;
        }

        for i in 0..10u32 {
            assert_eq!(map.get(&i), Some(&(i * 2)));
        }
    }

    // ==================== Stress Tests ====================

    #[test]
    fn stress_test() {
        use rand::rngs::StdRng;
        use rand::{Rng, SeedableRng};

        let seed: [u8; 32] = [
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
            25, 26, 27, 28, 29, 30, 31, 32,
        ];
        let mut rng = StdRng::from_seed(seed);

        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();
        let mut op_count = 0u32;

        // Insert 1000 random elements
        for _ in 0..1000 {
            let key: u32 = rng.gen_range(0..10000);
            let value = key + 1;
            map.insert(key, value);
            std_map.insert(key, value);
            op_count += 1;
        }

        check_btree_invariants(&map, &format!("after {} ops (insert phase)", op_count));
        compare_with_std(
            &map,
            &std_map,
            &format!("after {} ops (insert phase)", op_count),
        );

        // Remove 500 random elements
        for _ in 0..500 {
            let key: u32 = rng.gen_range(0..10000);
            let ours = map.remove(&key);
            let std = std_map.remove(&key);
            if ours != std {
                println!(
                    "Remove mismatch at op {}: key={}, ours={:?}, std={:?}",
                    op_count, key, ours, std
                );
                print_btree(&map);
                panic!("Remove result mismatch");
            }
            op_count += 1;
        }

        check_btree_invariants(&map, &format!("after {} ops (remove phase)", op_count));
        compare_with_std(
            &map,
            &std_map,
            &format!("after {} ops (remove phase)", op_count),
        );

        // Mixed operations
        for _ in 0..1000 {
            let op: u8 = rng.gen_range(0..3);
            let key: u32 = rng.gen_range(0..10000);

            match op {
                0 => {
                    // Insert
                    map.insert(key, key + 1);
                    std_map.insert(key, key + 1);
                }
                1 => {
                    // Remove
                    let ours = map.remove(&key);
                    let std = std_map.remove(&key);
                    if ours != std {
                        println!(
                            "Remove mismatch at op {}: key={}, ours={:?}, std={:?}",
                            op_count, key, ours, std
                        );
                        print_btree(&map);
                        panic!("Remove result mismatch");
                    }
                }
                _ => {
                    // Get
                    let ours = map.get(&key);
                    let std = std_map.get(&key);
                    if ours != std {
                        println!(
                            "Get mismatch at op {}: key={}, ours={:?}, std={:?}",
                            op_count, key, ours, std
                        );
                        print_btree(&map);
                        panic!("Get result mismatch");
                    }
                }
            }
            op_count += 1;
        }

        check_btree_invariants(&map, &format!("after {} ops (mixed phase)", op_count));
        compare_with_std(
            &map,
            &std_map,
            &format!("after {} ops (mixed phase)", op_count),
        );

        // Remove all remaining
        let keys: Vec<_> = std_map.keys().cloned().collect();
        for key in keys {
            let ours = map.remove(&key);
            let std = std_map.remove(&key);
            if ours != std {
                println!(
                    "Final remove mismatch: key={}, ours={:?}, std={:?}",
                    key, ours, std
                );
                print_btree(&map);
                panic!("Remove result mismatch");
            }
            check_btree_invariants(&map, &format!("after removing {} in final cleanup", key));
        }

        assert!(map.is_empty());
        println!("Stress test done!");
    }

    #[test]
    fn stress_test_random() {
        use rand::rngs::StdRng;
        use rand::{Rng, SeedableRng};
        use std::time::{SystemTime, UNIX_EPOCH};

        // Generate a random seed from system time and print it for reproducibility
        let time_seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64;

        let random_seed = time_seed.wrapping_mul(31);

        println!("Random stress test seed: {}", random_seed);
        println!("To reproduce: set STRESS_TEST_SEED={}", random_seed);

        // Allow override via environment variable for reproduction
        let seed = std::env::var("STRESS_TEST_SEED")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(random_seed);

        let mut rng = StdRng::seed_from_u64(seed);

        // Run multiple iterations with different operation mixes
        for iteration in 0..10 {
            let mut map = BTreeMap::new();
            let mut std_map = StdBTreeMap::new();

            // Vary the key range and operation count per iteration
            let key_range = rng.gen_range(100..10000);
            let op_count = rng.gen_range(500..5000);

            for op_idx in 0..op_count {
                let op: u8 = rng.gen_range(0..10);
                let key: u32 = rng.gen_range(0..key_range);

                match op {
                    0..=4 => {
                        // 50% insert
                        map.insert(key, key + 1);
                        std_map.insert(key, key + 1);
                    }
                    5..=7 => {
                        // 30% remove
                        let ours = map.remove(&key);
                        let std = std_map.remove(&key);
                        if ours != std {
                            println!("seed={} iteration={} op={}", seed, iteration, op_idx);
                            println!(
                                "Remove mismatch: key={}, ours={:?}, std={:?}",
                                key, ours, std
                            );
                            print_btree(&map);
                            panic!("Remove result mismatch");
                        }
                    }
                    _ => {
                        // 20% get
                        let ours = map.get(&key);
                        let std = std_map.get(&key);
                        if ours != std {
                            println!("seed={} iteration={} op={}", seed, iteration, op_idx);
                            println!("Get mismatch: key={}, ours={:?}, std={:?}", key, ours, std);
                            print_btree(&map);
                            panic!("Get result mismatch");
                        }
                    }
                }

                // Periodic invariant checks (not every op, for performance)
                if op_idx % 100 == 0 {
                    check_btree_invariants(
                        &map,
                        &format!("seed={} iter={} op={}", seed, iteration, op_idx),
                    );
                }
            }

            // Full check at end of iteration
            check_btree_invariants(&map, &format!("seed={} iter={} final", seed, iteration));
            compare_with_std(
                &map,
                &std_map,
                &format!("seed={} iter={} final", seed, iteration),
            );

            // Drain all remaining keys
            let keys: Vec<_> = std_map.keys().cloned().collect();
            for key in keys {
                let ours = map.remove(&key);
                let std = std_map.remove(&key);
                assert_eq!(ours, std, "Drain mismatch at key {}", key);
            }
            assert!(map.is_empty());
        }

        println!("Random stress test passed with seed {}", seed);
    }

    #[test]
    fn stress_test_edge_cases() {
        use rand::rngs::StdRng;
        use rand::{Rng, SeedableRng};

        let seed = std::env::var("STRESS_TEST_SEED")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(12345);

        let mut rng = StdRng::seed_from_u64(seed);

        // Test 1: Ascending then descending removal (triggers different rebalance paths)
        {
            let mut map = BTreeMap::new();
            let mut std_map = StdBTreeMap::new();
            for i in 0..1000u32 {
                map.insert(i, i);
                std_map.insert(i, i);
            }
            // Remove from middle outward
            for i in (0..500).rev() {
                map.remove(&(500 + i));
                std_map.remove(&(500 + i));
                map.remove(&i);
                std_map.remove(&i);
                check_btree_invariants(&map, &format!("middle-out removal at {}", i));
            }
        }

        // Test 2: Repeated insert/remove of same key
        {
            let mut map = BTreeMap::new();
            let mut std_map = StdBTreeMap::new();
            for _ in 0..1000 {
                let key: u32 = rng.gen_range(0..10); // Very small key range
                if rng.gen_bool(0.5) {
                    map.insert(key, key);
                    std_map.insert(key, key);
                } else {
                    map.remove(&key);
                    std_map.remove(&key);
                }
            }
            check_btree_invariants(&map, "repeated same keys");
            compare_with_std(&map, &std_map, "repeated same keys");
        }

        // Test 3: Build to specific tree heights then tear down
        {
            let mut map = BTreeMap::new();
            let mut std_map = StdBTreeMap::new();
            // Insert enough to force multiple levels
            for i in 0..10000u32 {
                map.insert(i, i);
                std_map.insert(i, i);
            }
            check_btree_invariants(&map, "after 10k inserts");

            // Remove every other key
            for i in (0..10000u32).step_by(2) {
                map.remove(&i);
                std_map.remove(&i);
            }
            check_btree_invariants(&map, "after removing evens");
            compare_with_std(&map, &std_map, "after removing evens");
        }

        println!("Edge case stress tests passed");
    }

    // ==================== Algorithm Correctness Tests ====================

    /// Test that exercises all rebalance paths deterministically
    /// With B=3: nodes have [2,5] keys, borrow requires sibling with >=3 keys

    #[test]
    fn test_rotate_right_leaf() {
        // Build a tree where removing from right child triggers rotate_right
        // Need: left sibling has >= B keys, right child underflows
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        // Insert keys to create a specific structure
        // With B=3, we need to carefully construct the tree
        for i in 0..20u32 {
            map.insert(i, i);
            std_map.insert(i, i);
        }
        check_btree_invariants(&map, "after initial inserts for rotate_right_leaf");

        // Remove from the right side to trigger rotate_right
        // We remove keys that will cause the rightmost leaf to underflow
        // while the left sibling still has enough keys to donate
        for i in (15..20u32).rev() {
            map.remove(&i);
            std_map.remove(&i);
            check_btree_invariants(&map, &format!("after removing {} in rotate_right_leaf", i));
            compare_with_std(
                &map,
                &std_map,
                &format!("after removing {} in rotate_right_leaf", i),
            );
        }
    }

    #[test]
    fn test_rotate_left_leaf() {
        // Build a tree where removing from left child triggers rotate_left
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        for i in 0..20u32 {
            map.insert(i, i);
            std_map.insert(i, i);
        }
        check_btree_invariants(&map, "after initial inserts for rotate_left_leaf");

        // Remove from the left side to trigger rotate_left
        for i in 0..5u32 {
            map.remove(&i);
            std_map.remove(&i);
            check_btree_invariants(&map, &format!("after removing {} in rotate_left_leaf", i));
            compare_with_std(
                &map,
                &std_map,
                &format!("after removing {} in rotate_left_leaf", i),
            );
        }
    }

    #[test]
    fn test_merge_with_left_leaf() {
        // Force merge_with_left: remove until both siblings have exactly B-1 keys
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        // Create a tree with multiple leaves
        for i in 0..15u32 {
            map.insert(i, i);
            std_map.insert(i, i);
        }
        check_btree_invariants(&map, "after initial inserts for merge_with_left");

        // Systematically remove to force merges
        // Remove every other key to deplete nodes evenly
        for i in (0..15u32).filter(|x| x % 3 == 0) {
            map.remove(&i);
            std_map.remove(&i);
            check_btree_invariants(&map, &format!("after removing {} in merge_with_left", i));
            compare_with_std(
                &map,
                &std_map,
                &format!("after removing {} in merge_with_left", i),
            );
        }
    }

    #[test]
    fn test_merge_with_right_leaf() {
        // Force merge_with_right: leftmost child underflows with no left sibling
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        for i in 0..15u32 {
            map.insert(i, i);
            std_map.insert(i, i);
        }
        check_btree_invariants(&map, "after initial inserts for merge_with_right");

        // Remove smallest keys repeatedly - this affects the leftmost child
        // which has no left sibling, forcing merge_with_right
        for i in 0..10u32 {
            map.remove(&i);
            std_map.remove(&i);
            check_btree_invariants(&map, &format!("after removing {} in merge_with_right", i));
            compare_with_std(
                &map,
                &std_map,
                &format!("after removing {} in merge_with_right", i),
            );
        }
    }

    #[test]
    fn test_remove_from_internal_node() {
        // Remove a key that exists in an internal node (not leaf)
        // This tests the successor replacement logic
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        // Build a deeper tree
        for i in 0..50u32 {
            map.insert(i, i);
            std_map.insert(i, i);
        }
        check_btree_invariants(&map, "after building tree for internal remove");

        // Print tree to see structure
        println!("Tree before internal node removal:");
        print_btree(&map);

        // Remove keys that are likely in internal nodes
        // These are typically the median values that got promoted during splits
        for key in [10, 20, 25, 30, 15, 5] {
            if std_map.contains_key(&key) {
                map.remove(&key);
                std_map.remove(&key);
                check_btree_invariants(&map, &format!("after removing internal key {}", key));
                compare_with_std(
                    &map,
                    &std_map,
                    &format!("after removing internal key {}", key),
                );
            }
        }
    }

    #[test]
    fn test_cascading_rebalance() {
        // Create a deep tree and remove keys to cause rebalancing to propagate up
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        // Insert many keys to create a tree with multiple levels
        for i in 0..200u32 {
            map.insert(i, i);
            std_map.insert(i, i);
        }
        check_btree_invariants(&map, "after building deep tree");

        // Remove in a pattern that causes cascading merges/rotations
        // Remove from middle sections to stress internal node rebalancing
        for i in (50..150u32).step_by(2) {
            map.remove(&i);
            std_map.remove(&i);
            check_btree_invariants(&map, &format!("after removing {} in cascading test", i));
        }
        compare_with_std(&map, &std_map, "after cascading removes");
    }

    #[test]
    fn test_root_shrink() {
        // Test that root correctly shrinks when it becomes empty
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        // Build tree then remove all but a few keys
        for i in 0..20u32 {
            map.insert(i, i);
            std_map.insert(i, i);
        }

        // Remove most keys, watching for root shrink
        for i in 0..18u32 {
            map.remove(&i);
            std_map.remove(&i);
            check_btree_invariants(&map, &format!("after removing {} in root_shrink test", i));
            compare_with_std(
                &map,
                &std_map,
                &format!("after removing {} in root_shrink test", i),
            );
        }

        // Only 2 keys left - should have simple structure
        assert_eq!(map.len(), 2);
    }

    #[test]
    fn test_split_propagation() {
        // Test that splits correctly propagate up the tree
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        // Insert in order to force repeated splits
        for i in 0..100u32 {
            map.insert(i, i);
            std_map.insert(i, i);
            check_btree_invariants(&map, &format!("after inserting {} in split_propagation", i));
        }
        compare_with_std(&map, &std_map, "after all inserts in split_propagation");
    }

    #[test]
    fn test_split_with_children() {
        // Test splitting of internal nodes (nodes with children)
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        // Build a tree that will have internal node splits
        // Insert enough to create at least 3 levels
        for i in 0..100u32 {
            map.insert(i, i);
            std_map.insert(i, i);
        }
        check_btree_invariants(&map, "after building 3-level tree");

        // Continue inserting to force internal node splits
        for i in 100..200u32 {
            map.insert(i, i);
            std_map.insert(i, i);
            if i % 10 == 0 {
                check_btree_invariants(
                    &map,
                    &format!("after inserting {} in split_with_children", i),
                );
            }
        }
        compare_with_std(&map, &std_map, "after all inserts in split_with_children");
    }

    #[test]
    fn test_remove_smallest_chain() {
        // Test remove_smallest through multiple levels
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        for i in 0..50u32 {
            map.insert(i, i);
            std_map.insert(i, i);
        }

        // Removing keys from internal nodes uses remove_smallest
        // Remove the middle key which is likely in an internal node
        let middle_keys: Vec<u32> = (20..30).collect();
        for key in middle_keys {
            map.remove(&key);
            std_map.remove(&key);
            check_btree_invariants(
                &map,
                &format!("after removing {} in remove_smallest_chain", key),
            );
            compare_with_std(
                &map,
                &std_map,
                &format!("after removing {} in remove_smallest_chain", key),
            );
        }
    }

    #[test]
    fn test_alternating_insert_remove() {
        // Test interleaved insert/remove operations
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        for round in 0..10u32 {
            // Insert batch
            for i in (round * 20)..((round + 1) * 20) {
                map.insert(i, i);
                std_map.insert(i, i);
            }
            check_btree_invariants(&map, &format!("after insert round {}", round));

            // Remove some from earlier
            if round > 0 {
                for i in ((round - 1) * 20)..((round - 1) * 20 + 10) {
                    map.remove(&i);
                    std_map.remove(&i);
                }
                check_btree_invariants(&map, &format!("after remove in round {}", round));
            }
            compare_with_std(&map, &std_map, &format!("end of round {}", round));
        }
    }

    #[test]
    fn test_boundary_key_removal() {
        // Test removing keys at node boundaries (first/last in nodes)
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        for i in 0..30u32 {
            map.insert(i, i);
            std_map.insert(i, i);
        }
        check_btree_invariants(&map, "initial tree for boundary removal");

        // Remove in a pattern that hits boundary cases
        // First key, last key, then work inward
        let removal_order = [0u32, 29, 1, 28, 2, 27, 3, 26, 4, 25, 5, 24];
        for &key in &removal_order {
            map.remove(&key);
            std_map.remove(&key);
            check_btree_invariants(&map, &format!("after boundary removal of {}", key));
            compare_with_std(
                &map,
                &std_map,
                &format!("after boundary removal of {}", key),
            );
        }
    }

    #[test]
    fn test_reinsert_after_remove() {
        // Test that reinserting removed keys works correctly
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        // Build, remove, rebuild
        for i in 0..20u32 {
            map.insert(i, i);
            std_map.insert(i, i);
        }

        // Remove half
        for i in 0..10u32 {
            map.remove(&i);
            std_map.remove(&i);
        }
        check_btree_invariants(&map, "after first removal phase");

        // Reinsert removed keys with different values
        for i in 0..10u32 {
            map.insert(i, i + 100);
            std_map.insert(i, i + 100);
        }
        check_btree_invariants(&map, "after reinsertion");
        compare_with_std(&map, &std_map, "after reinsertion");

        // Verify values are updated
        for i in 0..10u32 {
            assert_eq!(map.get(&i), Some(&(i + 100)));
        }
    }

    #[test]
    fn test_dense_key_space() {
        // Test with very dense key space (every integer in range)
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        // Insert all keys 0..N
        let n = 100u32;
        for i in 0..n {
            map.insert(i, i);
            std_map.insert(i, i);
        }
        check_btree_invariants(&map, "dense insert complete");

        // Remove all odd keys
        for i in (1..n).step_by(2) {
            map.remove(&i);
            std_map.remove(&i);
        }
        check_btree_invariants(&map, "after removing odd keys");
        compare_with_std(&map, &std_map, "after removing odd keys");

        // Remove all remaining keys
        for i in (0..n).step_by(2) {
            map.remove(&i);
            std_map.remove(&i);
            check_btree_invariants(&map, &format!("removing even key {}", i));
        }
        assert!(map.is_empty());
    }

    #[test]
    fn test_specific_b3_scenarios() {
        // Test scenarios specific to B=3 (nodes have 2-5 keys)
        let mut map = BTreeMap::new();
        let mut std_map = StdBTreeMap::new();

        // Scenario 1: Fill exactly to cause first split (6 keys = 2B)
        for i in 0..6u32 {
            map.insert(i, i);
            std_map.insert(i, i);
        }
        check_btree_invariants(&map, "exactly at first split point");
        compare_with_std(&map, &std_map, "exactly at first split point");

        // Scenario 2: Continue to fill both children to cause another split
        for i in 6..12u32 {
            map.insert(i, i);
            std_map.insert(i, i);
        }
        check_btree_invariants(&map, "after second split region");

        // Scenario 3: Remove to exactly minimum (B-1 = 2 keys per node)
        // then remove one more to trigger rebalance
        let keys_to_keep: std::collections::HashSet<u32> =
            [0, 1, 5, 6, 10, 11].iter().cloned().collect();
        for i in 0..12u32 {
            if !keys_to_keep.contains(&i) {
                map.remove(&i);
                std_map.remove(&i);
                check_btree_invariants(&map, &format!("B3 scenario removing {}", i));
            }
        }
        compare_with_std(&map, &std_map, "B3 scenarios complete");
    }

    #[test]
    fn benchmark() {
        use rand::rngs::StdRng;
        use rand::{Rng, SeedableRng};
        use std::time::Instant;

        let seed: [u8; 32] = [
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
            25, 26, 27, 28, 29, 30, 31, 32,
        ];

        let n = 100000;

        // Benchmark our implementation
        let mut rng = StdRng::from_seed(seed);
        let start = Instant::now();
        let mut map = BTreeMap::new();
        for _ in 0..n {
            let key: u32 = rng.gen();
            map.insert(key, key + 1);
        }
        let keys: Vec<_> = map.iter().map(|(k, _)| *k).collect();
        for k in keys {
            map.remove(&k);
        }
        let our_time = start.elapsed();

        // Benchmark std implementation
        let mut rng = StdRng::from_seed(seed);
        let start = Instant::now();
        let mut std_map = StdBTreeMap::new();
        for _ in 0..n {
            let key: u32 = rng.gen();
            std_map.insert(key, key + 1);
        }
        let keys: Vec<_> = std_map.iter().map(|(k, _)| *k).collect();
        for k in keys {
            std_map.remove(&k);
        }
        let std_time = start.elapsed();

        println!("Our BTreeMap:  {:?}", our_time);
        println!("Std BTreeMap:  {:?}", std_time);
    }
}
