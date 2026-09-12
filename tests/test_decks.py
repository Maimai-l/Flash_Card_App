from app.db.deck_repo import normalise_path, root_of, split_path


def test_path_helpers():
    assert split_path(" Mathematics :: Linear Algebra ") == ["Mathematics", "Linear Algebra"]
    assert normalise_path("A ::  B") == "A::B"
    assert root_of("Mathematics::Linear Algebra::Eigen") == "Mathematics"
    assert root_of("") == ""


def test_ensure_path_creates_every_level(context):
    leaf = context.decks.ensure_path("Mathematics::Linear Algebra::Eigenvalues")
    paths = [d["path"] for d in context.decks.all_decks()]
    assert paths == [
        "Mathematics",
        "Mathematics::Linear Algebra",
        "Mathematics::Linear Algebra::Eigenvalues",
    ]
    assert context.decks.by_id(leaf)["name"] == "Eigenvalues"


def test_ensure_path_is_idempotent(context):
    first = context.decks.ensure_path("CS::Networks")
    second = context.decks.ensure_path("CS::Networks")
    assert first == second
    assert len(context.decks.all_decks()) == 2


def test_descendant_ids_covers_subtree_only(context):
    context.decks.ensure_path("Mathematics::Linear Algebra")
    context.decks.ensure_path("Mathematics::Calculus")
    context.decks.ensure_path("CS::Networks")

    maths = context.decks.descendant_ids("Mathematics")
    assert len(maths) == 3  # the subject plus two chapters
    assert len(context.decks.descendant_ids("Mathematics::Calculus")) == 1
    assert len(context.decks.descendant_ids("")) == 5  # unscoped means everything


def test_rename_rewrites_the_subtree(context):
    context.decks.ensure_path("Maths::Linear Algebra::Eigen")
    context.decks.rename("Maths", "Mathematics")
    paths = [d["path"] for d in context.decks.all_decks()]
    assert paths == [
        "Mathematics",
        "Mathematics::Linear Algebra",
        "Mathematics::Linear Algebra::Eigen",
    ]


def test_delete_removes_subtree_and_cards(context):
    deck_id = context.decks.ensure_path("Maths::Linear Algebra")
    context.cards.create(deck_id, "front", "back")
    context.decks.delete("Maths")
    assert context.decks.all_decks() == []
    assert context.cards.count_all(None) == 0


def test_limits_are_read_from_the_root(context):
    context.decks.ensure_path("Mathematics::Linear Algebra")
    context.decks.set_limits("Mathematics", 5, 25)
    assert context.decks.limits_for("Mathematics::Linear Algebra") == (5, 25)


def test_a_subtree_stays_with_its_parent_when_a_sibling_extends_the_name(context):
    """"Communication" and "Communication and Internet Technologies" are
    siblings. A raw string sort puts the longer name between the shorter one
    and its own children, because the space in "and" sorts before the colons
    of "::". The tree must sort by segments so every subtree is contiguous."""
    for path in [
        "Computer Science::Communication::Hardware and Ethernet",
        "Computer Science::Communication::Topologies",
        "Computer Science::Communication and Internet Technologies::Packet Switching",
    ]:
        context.decks.ensure_path(path)

    paths = [d["path"] for d in context.study.deck_tree()]
    i = paths.index("Computer Science::Communication")
    assert paths[i + 1] == "Computer Science::Communication::Hardware and Ethernet"
    assert paths[i + 2] == "Computer Science::Communication::Topologies"
    assert paths[i + 3] == "Computer Science::Communication and Internet Technologies"
    assert paths[i + 4] == ("Computer Science::Communication and Internet "
                            "Technologies::Packet Switching")
