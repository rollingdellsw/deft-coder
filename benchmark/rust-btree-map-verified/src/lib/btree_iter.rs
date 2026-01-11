use crate::btree_node::Node;
use std::cell::RefCell;
use std::rc::Rc;

pub struct Iter<'a, K, V> {
    // Stack of (NodeRef, Index)
    #[allow(clippy::type_complexity)]
    stack: Vec<(Rc<RefCell<Node<K, V>>>, usize)>,
    marker: std::marker::PhantomData<&'a V>,
}

impl<'a, K, V> Iter<'a, K, V> {
    pub(super) fn new(root: Option<Rc<RefCell<Node<K, V>>>>) -> Self {
        let mut iter = Iter {
            stack: Vec::new(),
            marker: std::marker::PhantomData,
        };
        if let Some(r) = root {
            iter.push_leftmost(r);
        }
        iter
    }

    fn push_leftmost(&mut self, node_ref: Rc<RefCell<Node<K, V>>>) {
        self.stack.push((node_ref, 0));
        loop {
            let idx = self.stack.last().unwrap().1;
            let current = self.stack.last().unwrap().0.clone();
            let node = current.borrow();
            if idx < node.length as usize && node.children[idx].is_some() {
                let child = node.children[idx].clone().unwrap();
                drop(node);
                self.stack.push((child, 0));
            } else {
                break;
            }
        }
    }
}

impl<'a, K: 'a, V: 'a> Iterator for Iter<'a, K, V> {
    type Item = (&'a K, &'a V);

    fn next(&mut self) -> Option<Self::Item> {
        if self.stack.is_empty() {
            return None;
        }

        let node_ref = self.stack.last().unwrap().0.clone();
        let idx = self.stack.last().unwrap().1;
        let node = node_ref.borrow();

        if idx < node.length as usize {
            unsafe {
                let k = &*node.keys[idx].as_ptr();
                let v = &*node.values[idx].as_ptr();

                // Advance index
                self.stack.last_mut().unwrap().1 += 1;

                // Check if we need to go down a child
                if node.children[idx + 1].is_some() {
                    let child = node.children[idx + 1].clone().unwrap();
                    drop(node);
                    self.push_leftmost(child);
                } else {
                    // If current node exhausted, pop
                    loop {
                        if self.stack.is_empty() {
                            break;
                        }
                        let p_idx = self.stack.last().unwrap().1;
                        let p_ref = self.stack.last().unwrap().0.clone();
                        let parent = p_ref.borrow();
                        if p_idx < parent.length as usize {
                            break;
                        }
                        drop(parent);
                        self.stack.pop();
                    }
                }
                return Some((k, v));
            }
        }
        None
    }
}

pub struct IterMut<'a, K, V> {
    #[allow(clippy::type_complexity)]
    stack: Vec<(Rc<RefCell<Node<K, V>>>, usize)>,
    marker: std::marker::PhantomData<&'a mut V>,
}

impl<'a, K, V> IterMut<'a, K, V> {
    pub(super) fn new(root: Option<Rc<RefCell<Node<K, V>>>>) -> Self {
        let mut iter = IterMut {
            stack: Vec::new(),
            marker: std::marker::PhantomData,
        };
        if let Some(r) = root {
            iter.push_leftmost(r);
        }
        iter
    }

    fn push_leftmost(&mut self, node_ref: Rc<RefCell<Node<K, V>>>) {
        self.stack.push((node_ref, 0));
        loop {
            let idx = self.stack.last().unwrap().1;
            let current = self.stack.last().unwrap().0.clone();
            let node = current.borrow();
            if idx < node.length as usize && node.children[idx].is_some() {
                let child = node.children[idx].clone().unwrap();
                drop(node);
                self.stack.push((child, 0));
            } else {
                break;
            }
        }
    }
}

impl<'a, K: 'a, V: 'a> Iterator for IterMut<'a, K, V> {
    type Item = (&'a K, &'a mut V);

    fn next(&mut self) -> Option<Self::Item> {
        if self.stack.is_empty() {
            return None;
        }

        let node_ref = self.stack.last().unwrap().0.clone();
        let idx = self.stack.last().unwrap().1;
        let mut node = node_ref.borrow_mut();

        if idx < node.length as usize {
            unsafe {
                let k = &*node.keys[idx].as_ptr();
                let v = &mut *node.values[idx].as_mut_ptr();

                self.stack.last_mut().unwrap().1 += 1;
                drop(node);

                // We need a re-borrow to check children for the next step
                if node_ref.borrow().children[idx + 1].is_some() {
                    let child = node_ref.borrow().children[idx + 1].clone().unwrap();
                    self.push_leftmost(child);
                } else {
                    loop {
                        if self.stack.is_empty() {
                            break;
                        }
                        let p_idx = self.stack.last().unwrap().1;
                        let p_ref = self.stack.last().unwrap().0.clone();
                        let parent = p_ref.borrow();
                        if p_idx < parent.length as usize {
                            break;
                        }
                        drop(parent);
                        self.stack.pop();
                    }
                }
                return Some((k, v));
            }
        }
        None
    }
}
