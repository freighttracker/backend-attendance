// Curated Indian name pools. Faker's bundled locales don't ship a reliable
// Indian name set, so names are drawn from these lists (via faker.helpers.
// arrayElement, so selection is still faker-driven/random-seeded), while
// faker itself is used for dates, ids and other generic randomization
// throughout the seeders.

const MALE_FIRST_NAMES = [
    'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan',
    'Kabir', 'Aryan', 'Dhruv', 'Karan', 'Rahul', 'Rajesh', 'Suresh', 'Amit', 'Vikram', 'Anil',
    'Sandeep', 'Manoj', 'Nikhil', 'Gaurav', 'Ashok', 'Ravi', 'Deepak', 'Vijay', 'Sanjay', 'Ankit',
    'Harsh', 'Yash', 'Varun', 'Siddharth', 'Abhishek', 'Pranav', 'Naveen', 'Rakesh', 'Vinod', 'Manish',
    'Akash', 'Kunal', 'Tarun', 'Gopal', 'Ramesh', 'Mahesh', 'Prakash', 'Sunil', 'Ajay', 'Nitin'
];

const FEMALE_FIRST_NAMES = [
    'Saanvi', 'Ananya', 'Aadhya', 'Diya', 'Myra', 'Priya', 'Neha', 'Kavya', 'Anjali', 'Pooja',
    'Sneha', 'Ritu', 'Deepika', 'Shreya', 'Isha', 'Nisha', 'Divya', 'Swati', 'Meera', 'Kirti',
    'Aishwarya', 'Sunita', 'Rekha', 'Geeta', 'Lata', 'Poonam', 'Preeti', 'Suman', 'Vidya', 'Manisha',
    'Radhika', 'Simran', 'Tanvi', 'Bhavna', 'Namrata', 'Alisha', 'Komal', 'Yamini', 'Riya', 'Jyoti',
    'Kajal', 'Shalini', 'Rashmi', 'Anita', 'Sarika', 'Vandana', 'Payal', 'Nidhi', 'Aarti', 'Sonali'
];

const NEUTRAL_FIRST_NAMES = ['Amar', 'Kiran', 'Sanju', 'Alex', 'Robin'];

const LAST_NAMES = [
    'Sharma', 'Verma', 'Gupta', 'Kumar', 'Singh', 'Patel', 'Shah', 'Mehta', 'Joshi', 'Desai',
    'Iyer', 'Nair', 'Menon', 'Pillai', 'Reddy', 'Rao', 'Naidu', 'Chatterjee', 'Banerjee', 'Mukherjee',
    'Das', 'Bose', 'Ghosh', 'Kapoor', 'Malhotra', 'Chopra', 'Khanna', 'Bhatia', 'Arora', 'Sethi',
    'Agarwal', 'Jain', 'Mishra', 'Pandey', 'Tiwari', 'Dubey', 'Trivedi', 'Yadav', 'Chauhan', 'Rathore',
    'Solanki', 'Thakur', 'Bhatt', 'Saxena', 'Srivastava', 'Nayar', 'Rajan', 'Krishnan', 'Subramaniam', 'Varma'
];

const RELATIONS = ['Father', 'Mother', 'Spouse', 'Brother', 'Sister', 'Friend'];

module.exports = {
    MALE_FIRST_NAMES,
    FEMALE_FIRST_NAMES,
    NEUTRAL_FIRST_NAMES,
    LAST_NAMES,
    RELATIONS
};
