use std::borrow::Borrow;
use std::cell::RefCell;
use std::cmp::Ordering;
use std::mem::{self, MaybeUninit};
use std::ptr;
use std::rc::Rc;

pub(super) const B: usize = 3;

// We use MaybeUninit to avoid requiring K: Default and V: Default.
#[allow(clippy::type_complexity)]
pub(super) struct Node<K, V> {
    pub(super) keys: [MaybeUninit<K>; B * 2],
    pub(super) values: [MaybeUninit<V>; B * 2],
    pub(super) children: [Option<Rc<RefCell<Node<K, V>>>>; 2 * B + 1],
    pub(super) length: u16,
}

impl<K, V> Node<K, V> {
    pub(super) fn new() -> Self {
        unsafe {
            Node {
                keys: MaybeUninit::uninit().assume_init(),
                values: MaybeUninit::uninit().assume_init(),
                children: mem::zeroed(), // Option is null-optimized
                length: 0,
            }
        }
    }

    pub(super) fn is_leaf(&self) -> bool {
        self.children[0].is_none()
    }

    /// Finds the key. Returns Ok(index) if found, Err(index) if not.
    /// The index in Err represents the child slot to check.
    pub(super) fn find_slot<Q: ?Sized + Ord>(&self, key: &Q) -> Result<usize, usize>
    where
        K: Borrow<Q>,
    {
        for i in 0..self.length as usize {
            unsafe {
                let k = &*self.keys[i].as_ptr();
                match key.cmp(k.borrow()) {
                    Ordering::Less => return Err(i),
                    Ordering::Equal => return Ok(i),
                    Ordering::Greater => {}
                }
            }
        }
        Err(self.length as usize)
    }

    pub(super) fn insert_at(&mut self, idx: usize, key: K, value: V) {
        let len = self.length as usize;
        unsafe {
            // Shift keys/values right
            let keys_ptr = self.keys.as_mut_ptr();
            let values_ptr = self.values.as_mut_ptr();
            ptr::copy(keys_ptr.add(idx), keys_ptr.add(idx + 1), len - idx);
            ptr::copy(values_ptr.add(idx), values_ptr.add(idx + 1), len - idx);

            // Write new
            self.keys[idx].write(key);
            self.values[idx].write(value);
        }
        self.length += 1;
    }

    pub(super) fn remove_at(&mut self, idx: usize) -> (K, V) {
        let len = self.length as usize;
        unsafe {
            let k = self.keys[idx].assume_init_read();
            let v = self.values[idx].assume_init_read();

            // Shift left
            let keys_ptr = self.keys.as_mut_ptr();
            let values_ptr = self.values.as_mut_ptr();
            ptr::copy(keys_ptr.add(idx + 1), keys_ptr.add(idx), len - idx - 1);
            ptr::copy(values_ptr.add(idx + 1), values_ptr.add(idx), len - idx - 1);

            self.length -= 1;
            (k, v)
        }
    }

    #[allow(dead_code)]
    pub(super) fn add_child(&mut self, child: Option<Rc<RefCell<Node<K, V>>>>, idx: usize) {
        let len = self.length as usize;
        // Shift children right starting at idx
        for i in (idx..=len).rev() {
            self.children[i + 1] = self.children[i].take(); // take() to avoid cloning Rc unnecessarily
        }
        self.children[idx] = child;
    }

    #[allow(dead_code)]
    pub(super) fn remove_child(&mut self, idx: usize) -> Option<Rc<RefCell<Node<K, V>>>> {
        let len = self.length as usize;
        let ret = self.children[idx].take();
        for i in idx..=len {
            self.children[i] = self.children[i + 1].take();
        }
        ret
    }

    pub(super) fn split(&mut self) -> Node<K, V> {
        let mut new_node = Node::new();
        // Node has 2B keys (indices 0..2B-1) after overflow
        // After split:
        //   - Original keeps keys[0..B-2] (first B-1 keys), children[0..B-1] (first B children)
        //   - keys[B-1] is promoted to parent (via extract_middle called separately)
        //   - New node gets keys[B..2B-1] (last B keys), children[B..2B] (last B+1 children)
        unsafe {
            // Copy last B keys/values to new_node (indices B to 2B-1)
            ptr::copy_nonoverlapping(self.keys.as_ptr().add(B), new_node.keys.as_mut_ptr(), B);
            ptr::copy_nonoverlapping(self.values.as_ptr().add(B), new_node.values.as_mut_ptr(), B);
        }

        // Move children properly (can't use ptr::copy for Rc)
        for i in 0..=B {
            new_node.children[i] = self.children[B + i].take();
        }

        // Original keeps first B-1 keys, new node gets B keys
        self.length = (B - 1) as u16;
        new_node.length = B as u16;

        new_node
    }

    // Helper to extract the middle element for promotion
    pub(super) fn extract_middle(&mut self) -> (K, V) {
        unsafe {
            (
                self.keys[B - 1].assume_init_read(),
                self.values[B - 1].assume_init_read(),
            )
        }
    }
}

impl<K, V> Drop for Node<K, V> {
    fn drop(&mut self) {
        for i in 0..self.length as usize {
            unsafe {
                self.keys[i].assume_init_drop();
                self.values[i].assume_init_drop();
            }
        }
    }
}

#[cfg(test)]
impl<K: Clone, V: Clone> Node<K, V> {
    pub(super) fn bfs(&self, layer: usize, result: &mut Vec<Vec<Vec<(K, V)>>>) {
        if self.length == 0 {
            return;
        }
        let mut node_data = Vec::with_capacity(self.length as usize);
        for i in 0..self.length as usize {
            unsafe {
                node_data.push((
                    self.keys[i].assume_init_ref().clone(),
                    self.values[i].assume_init_ref().clone(),
                ));
            }
        }
        if result.len() > layer {
            result[layer].push(node_data);
        } else {
            result.push(vec![node_data]);
        }

        for i in 0..=self.length as usize {
            if let Some(ref c) = self.children[i] {
                RefCell::borrow(c).bfs(layer + 1, result);
            }
        }
    }
}
