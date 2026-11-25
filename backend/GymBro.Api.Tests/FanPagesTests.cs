using GymBro.Api.Profiles;

namespace GymBro.Api.Tests;

public class FanPagesTests
{
    [Fact]
    public void Keeps_up_to_four_pages_of_one_to_five_ids()
    {
        string?[] pages = ["search,scan,describe,quick,weight", "recipe", "mine,groups", "food"];
        Assert.Equal(pages, FanPages.Clean(pages));
        Assert.Empty(FanPages.Clean([])!);
    }

    // Pages separated by "|" here, to keep the cases on one line.
    [Theory]
    [InlineData("a|b|c|d|e")]
    [InlineData("a,b,c,d,e,f")]
    [InlineData("")]
    [InlineData("a,,b")]
    [InlineData("a,b|b")]
    [InlineData("has space")]
    public void Rejects_anything_else(string pages)
    {
        Assert.Null(FanPages.Clean(pages.Split('|')));
    }

    [Fact]
    public void Rejects_a_missing_page()
    {
        Assert.Null(FanPages.Clean(["search", null]));
    }
}
