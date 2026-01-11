use btree_map::BTreeMap;

fn main() {
    let mut movie_reviews = BTreeMap::<&str, &str>::new();

    // review some movies.
    movie_reviews.insert("Office Space", "Deals with real issues in the workplace.");
    movie_reviews.insert("Pulp Fiction", "Masterpiece.");
    movie_reviews.insert("The Godfather", "Very enjoyable.");
    movie_reviews.insert("The Blues Brothers", "Eye lyked it a lot.");

    // check for a specific one.
    if movie_reviews.get("Les Misérables").is_none() {
        println!("We've got some reviews, but Les Misérables ain't one.");
    }

    // oops, this review has a lot of spelling mistakes, let's delete it.
    movie_reviews.remove("The Blues Brothers");

    // Expected error: type `Option<&mut &str>` cannot be dereferenced
    // if let mut_review = movie_reviews.get_mut("Pulp Fiction") {
    //     *mut_review = " This is really enjoyable.";
    // }

    // look up the values associated with some keys.
    let to_find = ["Up!", "Office Space"];
    for movie in &to_find {
        match movie_reviews.get(movie) {
            Some(review) => println!("{movie}: {review}"),
            None => println!("{movie} is unreviewed."),
        }
    }

    // iterate over everything, do some in-place mutation.
    for (movie, review) in &mut movie_reviews {
        if movie != &"Office Space" {
            *review = "It is great, but it's not Office Space.";
        }
    }

    for (movie, review) in movie_reviews.iter() {
        println!("{movie}: \"{review}\"");
    }

    let (first_movie, first_review) = movie_reviews.iter().next().unwrap();
    assert_eq!(
        (*first_movie, *first_review),
        ("Office Space", "Deals with real issues in the workplace.")
    );
}
