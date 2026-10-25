package com.blufftable.domain;

public enum Avatar {
    DEFAULT("Default Avatar", 0), BOXING_CAT("Boxing Cat", 0),
    PORTRAIT("(look)", 500), GREEN_CHARACTER("mimimi", 5000);

    public final String label;
    public final long price;
    Avatar(String label, long price) { this.label = label; this.price = price; }
}
