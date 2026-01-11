Requiremnt:

Need to be able to run
$ MIRIFLAGS=-Zmiri-backtrace=full cargo miri test --features sanity_test

By install the rustc first:
$ curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

Then install miri and switch to nightly
$ rustup toolchain install nightly --component miri
$ rustup default nightly
