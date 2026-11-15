using GymBro.Api.Foods;

namespace GymBro.Api.Tests;

public sealed class FoodSearchStemTests
{
    [Theory]
    [InlineData("tomater", "tomat")]
    [InlineData("hermetiske", "hermetisk")]
    [InlineData("poteter", "potet")]
    [InlineData("tomatene", "tomat")]
    [InlineData("epler", "epl")]
    [InlineData("løken", "løk")]
    [InlineData("kjøttet", "kjøtt")]
    [InlineData("kokte", "kokt")]
    [InlineData("tomatoes", "tomato")]
    [InlineData("berries", "berry")]
    [InlineData("peaches", "peach")]
    [InlineData("carrots", "carrot")]
    public void Strips_one_common_ending(string word, string stem) =>
        Assert.Equal(stem, FoodSearchStem.Stem(word));

    [Theory]
    [InlineData("ris")]     // too short
    [InlineData("egg")]
    [InlineData("laks")]    // a short -s word is not a plural
    [InlineData("filet")]   // -et would leave "fil"
    [InlineData("melk")]
    [InlineData("glass")]
    [InlineData("cafe")]    // -e would leave "caf", which starts "café"
    [InlineData("b12")]
    public void Leaves_words_without_a_safe_ending(string word) =>
        Assert.Null(FoodSearchStem.Stem(word));
}
